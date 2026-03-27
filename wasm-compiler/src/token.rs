use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum TokenKind {
    // Keywords
    Pragma,
    Import,
    Export,
    Ledger,
    Circuit,
    Module,
    Const,
    Return,
    If,
    Else,
    Assert,
    Disclose,
    As,
    Prefix,
    LanguageVersion,

    // Literals
    IntLiteral(u64),
    StringLiteral(String),
    BoolLiteral(bool),

    // Identifiers
    Identifier(String),

    // Operators
    Plus,
    Minus,
    Star,
    #[allow(dead_code)]
    Slash,
    Percent,
    Eq,
    Neq,
    Lt,
    Gt,
    Lte,
    Gte,
    And,
    Or,
    Not,
    Assign,
    Dot,
    Comma,
    Colon,
    Semicolon,
    #[allow(dead_code)]
    Arrow,

    // Delimiters
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,

    // Special
    Comment(String),
    Whitespace,
    Newline,
    Eof,
    Unknown(char),
}

#[derive(Debug, Clone, Serialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
    pub text: String,
}
