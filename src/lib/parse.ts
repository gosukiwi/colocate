import ts from "typescript";
import { scopeRequireBinding } from "./require-binding.js";

function scriptKindFromFileName(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".mjs") ||
    fileName.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function parseSourceFile(
  fileName: string,
  content: string,
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFromFileName(fileName),
  );
}

export function stringLiteralText(
  node: ts.Node | undefined,
): string | undefined {
  if (node !== undefined && ts.isStringLiteralLike(node)) {
    return node.text;
  }
  return undefined;
}

function literalNode(
  node: ts.Node | undefined,
): ts.StringLiteralLike | undefined {
  if (node !== undefined && ts.isStringLiteralLike(node)) {
    return node;
  }
  return undefined;
}

function importedLiteral(
  node: ts.Node,
  requireIsCjs: boolean,
): ts.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalNode(node.moduleSpecifier);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return literalNode(node.moduleReference.expression);
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (requireIsCjs &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"))
  ) {
    return literalNode(node.arguments[0]);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalNode(node.argument.literal);
  }
  return undefined;
}

export function extractImports(
  content: string,
  fileName: string,
): { specifier: string; start: number; end: number }[] {
  const sourceFile = parseSourceFile(fileName, content);
  const imports: { specifier: string; start: number; end: number }[] = [];

  const visit = (node: ts.Node, inherited: boolean): void => {
    const binding = scopeRequireBinding(node);
    const requireIsCjs = binding === undefined ? inherited : binding === "cjs";
    const literal = importedLiteral(node, requireIsCjs);
    if (literal !== undefined) {
      imports.push({
        specifier: literal.text,
        start: literal.getStart(sourceFile),
        end: literal.getEnd(),
      });
    }
    ts.forEachChild(node, (child) => visit(child, requireIsCjs));
  };

  visit(sourceFile, true);
  return imports;
}

export function extractSpecifiers(content: string, fileName: string): string[] {
  return extractImports(content, fileName).map((i) => i.specifier);
}
