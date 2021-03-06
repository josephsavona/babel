import getFunctionArity from "./get-function-arity";
import * as util from  "../../util";
import * as t from "../../types";

var visitor = {
  enter(node, parent, scope, state) {
    // check if this node is a referenced identifier that matches the same as our
    // function id
    if (!this.isReferencedIdentifier({ name: state.name })) return;

    // check that we don't have a local variable declared as that removes the need
    // for the wrapper
    var localDeclar = scope.getBindingIdentifier(state.name);
    if (localDeclar !== state.outerDeclar) return;

    state.selfReference = true;
    this.stop();
  }
};

var wrap = function (state, method, id, scope) {
  if (state.selfReference) {
    var templateName = "property-method-assignment-wrapper";
    if (method.generator) templateName += "-generator";
    var template = util.template(templateName, {
      FUNCTION: method,
      FUNCTION_ID: id,
      FUNCTION_KEY: scope.generateUidIdentifier(id.name)
    });

    // shim in dummy params to retain function arity, if you try to read the
    // source then you'll get the original since it's proxied so it's all good
    var params = template.callee.body.body[0].params;
    for (var i = 0, len = getFunctionArity(method); i < len; i++) {
      params.push(scope.generateUidIdentifier("x"));
    }

    return template;
  } else {
    method.id = id;
    return method;
  }
};

var visit = function (node, name, scope) {
  var state = {
    selfAssignment: false,
    selfReference:  false,
    outerDeclar:    scope.getBindingIdentifier(name),
    references:     [],
    name:           name
  };

  // check to see if we have a local binding of the id we're setting inside of
  // the function, this is important as there are caveats associated

  var bindingInfo = scope.getOwnBindingInfo(name);

  if (bindingInfo) {
    if (bindingInfo.kind === "param") {
      // safari will blow up in strict mode with code like:
      //
      //   var t = function t(t) {};
      //
      // with the error:
      //
      //   Cannot declare a parameter named 't' as it shadows the name of a
      //   strict mode function.
      //
      // this isn't to the spec and they've invented this behaviour which is
      // **extremely** annoying so we avoid setting the name if it has a param
      // with the same id
      state.selfReference = true;
    } else {
      // otherwise it's defined somewhere in scope like:
      //
      //   var t = function () {
      //     var t = 2;
      //   };
      //
      // so we can safely just set the id and move along as it shadows the
      // bound function id
    }
  } else {
    scope.traverse(node, visitor, state);
  }

  return state;
};

export function custom(node, id, scope) {
  var state = visit(node, id.name, scope);
  return wrap(state, node, id, scope);
}

export function property(node, file, scope) {
  var key = t.toComputedKey(node, node.key);
  if (!t.isLiteral(key)) return node; // we can't set a function id with this

  var name = t.toIdentifier(key.value);
  var id = t.identifier(name);

  var method = node.value;
  var state  = visit(method, name, scope);
  node.value = wrap(state, method, id, scope);
}

export function bare(node, parent, scope) {
  // has an `id` so we don't need to infer one
  if (node.id) return node;

  var id;
  if (t.isProperty(parent) && parent.kind === "init" && (!parent.computed || t.isLiteral(parent.key))) {
    // { foo() {} };
    id = parent.key;
  } else if (t.isVariableDeclarator(parent)) {
    // var foo = function () {};
    id = parent.id;
  } else {
    return node;
  }

  var name;
  if (t.isLiteral(id)) {
    name = id.value;
  } else if (t.isIdentifier(id)) {
    name = id.name;
  } else {
    return;
  }

  name = t.toIdentifier(name);
  id = t.identifier(name);

  var state = visit(node, name, scope);
  return wrap(state, node, id, scope);
}
