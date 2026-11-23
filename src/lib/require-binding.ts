import ts from "typescript";

const CREATE_REQUIRE = "createRequire";

const REQUIRE = "require";

function tsIsCreateRequireCall(node: ts.Expression | undefined): boolean {
  if (node === undefined || !ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text === CREATE_REQUIRE;
  }
  return (
    ts.isPropertyAccessExpression(callee) && callee.name.text === CREATE_REQUIRE
  );
}

function bindsName(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) {
    return name.text === target;
  }
  return name.elements.some((element) =>
    ts.isBindingElement(element) ? bindsName(element.name, target) : false,
  );
}

function declarationBindsRequire(declaration: ts.VariableDeclaration): boolean {
  if (!bindsName(declaration.name, REQUIRE)) {
    return false;
  }
  return !tsIsCreateRequireCall(declaration.initializer);
}

function statementBindsRequire(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(declarationBindsRequire);
  }
  return (
    ts.isFunctionDeclaration(statement) && statement.name?.text === REQUIRE
  );
}

export function scopeBindsRequire(node: ts.Node): boolean {
  if (ts.isFunctionLike(node)) {
    if (node.parameters.some((p) => bindsName(p.name, REQUIRE))) {
      return true;
    }
  }

  const statements = ts.isSourceFile(node)
    ? node.statements
    : ts.isBlock(node) || ts.isModuleBlock(node)
      ? node.statements
      : undefined;
  if (statements === undefined) {
    return false;
  }

  return statements.some(statementBindsRequire);
}

function scopeStatements(node: ts.Node): readonly ts.Statement[] | undefined {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)
    ? node.statements
    : undefined;
}

function declaresCreateRequire(statement: ts.Statement): boolean {
  return (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (d) =>
        ts.isIdentifier(d.name) &&
        d.name.text === REQUIRE &&
        tsIsCreateRequireCall(d.initializer),
    )
  );
}

export function scopeRequireBinding(
  node: ts.Node,
): "cjs" | "shadowed" | undefined {
  if (scopeBindsRequire(node)) {
    return "shadowed";
  }
  return scopeStatements(node)?.some(declaresCreateRequire) === true
    ? "cjs"
    : undefined;
}
