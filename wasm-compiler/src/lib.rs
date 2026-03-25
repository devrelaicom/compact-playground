mod analyzer;
mod ast;
mod lexer;
mod parser;
mod token;

use analyzer::Analyzer;
use lexer::Lexer;
use parser::Parser;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct CompileResult {
    success: bool,
    ast: Option<ast::Program>,
    errors: Vec<parser::ParseError>,
    analysis: Option<analyzer::AnalysisResult>,
    tokens: Option<Vec<TokenInfo>>,
}

#[derive(Serialize)]
struct TokenInfo {
    kind: String,
    text: String,
    line: usize,
    column: usize,
    start: usize,
    end: usize,
}

/// Parse and analyze Compact source code, returning a JSON result.
///
/// The result includes:
/// - `success`: whether parsing succeeded without errors
/// - `ast`: the parsed AST (if successful)
/// - `errors`: any parse errors with line/column info
/// - `analysis`: semantic analysis results (diagnostics + summary)
/// - `tokens`: lexer token stream (for syntax highlighting)
#[wasm_bindgen]
pub fn parse_compact(source: &str) -> String {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize();

    let token_info: Vec<TokenInfo> = tokens
        .iter()
        .filter(|t| !matches!(t.kind, token::TokenKind::Eof))
        .map(|t| TokenInfo {
            kind: format!("{:?}", t.kind).split('(').next().unwrap_or("Unknown").to_string(),
            text: t.text.clone(),
            line: t.span.line,
            column: t.span.column,
            start: t.span.start,
            end: t.span.end,
        })
        .collect();

    let (program, errors) = Parser::new(tokens).parse();

    let analysis = if errors.is_empty() {
        Some(Analyzer::new().analyze(&program))
    } else {
        None
    };

    let result = CompileResult {
        success: errors.is_empty(),
        ast: if errors.is_empty() { Some(program) } else { None },
        errors,
        analysis,
        tokens: Some(token_info),
    };

    serde_json::to_string(&result).unwrap_or_else(|e| {
        format!(r#"{{"success":false,"errors":[{{"message":"Serialization error: {}","line":0,"column":0}}]}}"#, e)
    })
}

/// Get just the token stream for syntax highlighting (faster than full parse).
#[wasm_bindgen]
pub fn tokenize_compact(source: &str) -> String {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize();

    let token_info: Vec<TokenInfo> = tokens
        .iter()
        .filter(|t| !matches!(t.kind, token::TokenKind::Eof))
        .map(|t| TokenInfo {
            kind: format!("{:?}", t.kind).split('(').next().unwrap_or("Unknown").to_string(),
            text: t.text.clone(),
            line: t.span.line,
            column: t.span.column,
            start: t.span.start,
            end: t.span.end,
        })
        .collect();

    serde_json::to_string(&token_info).unwrap_or_else(|_| "[]".to_string())
}

/// Quick syntax check - returns only errors (fastest).
#[wasm_bindgen]
pub fn check_compact(source: &str) -> String {
    let mut lexer = Lexer::new(source);
    let tokens = lexer.tokenize();
    let (program, errors) = Parser::new(tokens).parse();

    let mut all_diagnostics: Vec<serde_json::Value> = errors
        .iter()
        .map(|e| {
            serde_json::json!({
                "severity": "Error",
                "message": e.message,
                "line": e.line,
                "column": e.column,
            })
        })
        .collect();

    if errors.is_empty() {
        let analysis = Analyzer::new().analyze(&program);
        for d in &analysis.diagnostics {
            all_diagnostics.push(serde_json::json!({
                "severity": d.severity,
                "message": d.message,
                "line": d.line,
                "column": d.column,
            }));
        }
    }

    serde_json::to_string(&all_diagnostics).unwrap_or_else(|_| "[]".to_string())
}
