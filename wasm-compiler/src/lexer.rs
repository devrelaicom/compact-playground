use crate::token::{Span, Token, TokenKind};

pub struct Lexer {
    source: Vec<char>,
    pos: usize,
    line: usize,
    column: usize,
}

impl Lexer {
    pub fn new(source: &str) -> Self {
        Self {
            source: source.chars().collect(),
            pos: 0,
            line: 1,
            column: 1,
        }
    }

    pub fn tokenize(&mut self) -> Vec<Token> {
        let mut tokens = Vec::new();
        loop {
            let token = self.next_token();
            let is_eof = token.kind == TokenKind::Eof;
            // Skip whitespace/newlines but keep comments
            match &token.kind {
                TokenKind::Whitespace | TokenKind::Newline => {}
                _ => tokens.push(token),
            }
            if is_eof {
                break;
            }
        }
        tokens
    }

    fn peek(&self) -> Option<char> {
        self.source.get(self.pos).copied()
    }

    fn peek_ahead(&self, n: usize) -> Option<char> {
        self.source.get(self.pos + n).copied()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.source.get(self.pos).copied()?;
        self.pos += 1;
        if ch == '\n' {
            self.line += 1;
            self.column = 1;
        } else {
            self.column += 1;
        }
        Some(ch)
    }

    fn make_span(&self, start: usize, start_line: usize, start_col: usize) -> Span {
        Span {
            start,
            end: self.pos,
            line: start_line,
            column: start_col,
        }
    }

    fn next_token(&mut self) -> Token {
        let start = self.pos;
        let start_line = self.line;
        let start_col = self.column;

        let ch = match self.advance() {
            Some(ch) => ch,
            None => {
                return Token {
                    kind: TokenKind::Eof,
                    span: self.make_span(start, start_line, start_col),
                    text: String::new(),
                };
            }
        };

        let kind = match ch {
            // Whitespace
            ' ' | '\t' | '\r' => {
                while matches!(self.peek(), Some(' ' | '\t' | '\r')) {
                    self.advance();
                }
                TokenKind::Whitespace
            }
            '\n' => TokenKind::Newline,

            // Comments
            '/' if self.peek() == Some('/') => {
                self.advance(); // consume second /
                let mut comment = String::new();
                while let Some(c) = self.peek() {
                    if c == '\n' {
                        break;
                    }
                    comment.push(c);
                    self.advance();
                }
                TokenKind::Comment(comment)
            }

            // Operators and punctuation
            '+' => TokenKind::Plus,
            '-' => TokenKind::Minus,
            '*' => TokenKind::Star,
            '%' => TokenKind::Percent,
            '.' => TokenKind::Dot,
            ',' => TokenKind::Comma,
            ':' => TokenKind::Colon,
            ';' => TokenKind::Semicolon,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '{' => TokenKind::LBrace,
            '}' => TokenKind::RBrace,
            '[' => TokenKind::LBracket,
            ']' => TokenKind::RBracket,

            '=' if self.peek() == Some('=') => {
                self.advance();
                TokenKind::Eq
            }
            '=' => TokenKind::Assign,

            '!' if self.peek() == Some('=') => {
                self.advance();
                TokenKind::Neq
            }
            '!' => TokenKind::Not,

            '<' if self.peek() == Some('=') => {
                self.advance();
                TokenKind::Lte
            }
            '<' => TokenKind::Lt,

            '>' if self.peek() == Some('=') => {
                self.advance();
                TokenKind::Gte
            }
            '>' => TokenKind::Gt,

            '&' if self.peek() == Some('&') => {
                self.advance();
                TokenKind::And
            }

            '|' if self.peek() == Some('|') => {
                self.advance();
                TokenKind::Or
            }

            // String literals
            '"' => {
                let mut s = String::new();
                loop {
                    match self.advance() {
                        Some('"') => break,
                        Some('\\') => {
                            if let Some(escaped) = self.advance() {
                                match escaped {
                                    'n' => s.push('\n'),
                                    't' => s.push('\t'),
                                    '\\' => s.push('\\'),
                                    '"' => s.push('"'),
                                    _ => {
                                        s.push('\\');
                                        s.push(escaped);
                                    }
                                }
                            }
                        }
                        Some(c) => s.push(c),
                        None => break,
                    }
                }
                TokenKind::StringLiteral(s)
            }

            // Numbers
            c if c.is_ascii_digit() => {
                let mut num = String::new();
                num.push(c);
                while let Some(d) = self.peek() {
                    if d.is_ascii_digit() || d == '_' {
                        if d != '_' {
                            num.push(d);
                        }
                        self.advance();
                    } else {
                        break;
                    }
                }
                // Check for version numbers like 0.21
                if self.peek() == Some('.') && matches!(self.peek_ahead(1), Some(d) if d.is_ascii_digit()) {
                    // This is a version number - treat as identifier-like
                    num.push('.');
                    self.advance();
                    while let Some(d) = self.peek() {
                        if d.is_ascii_digit() {
                            num.push(d);
                            self.advance();
                        } else {
                            break;
                        }
                    }
                    // Return as identifier to be handled by parser as version
                    TokenKind::Identifier(num)
                } else {
                    TokenKind::IntLiteral(num.parse().unwrap_or(0))
                }
            }

            // Identifiers and keywords
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut ident = String::new();
                ident.push(c);
                while let Some(d) = self.peek() {
                    if d.is_ascii_alphanumeric() || d == '_' {
                        ident.push(d);
                        self.advance();
                    } else {
                        break;
                    }
                }
                match ident.as_str() {
                    "pragma" => TokenKind::Pragma,
                    "language_version" => TokenKind::LanguageVersion,
                    "import" => TokenKind::Import,
                    "export" => TokenKind::Export,
                    "ledger" => TokenKind::Ledger,
                    "circuit" => TokenKind::Circuit,
                    "module" => TokenKind::Module,
                    "const" => TokenKind::Const,
                    "return" => TokenKind::Return,
                    "if" => TokenKind::If,
                    "else" => TokenKind::Else,
                    "assert" => TokenKind::Assert,
                    "disclose" => TokenKind::Disclose,
                    "as" => TokenKind::As,
                    "prefix" => TokenKind::Prefix,
                    "true" => TokenKind::BoolLiteral(true),
                    "false" => TokenKind::BoolLiteral(false),
                    _ => TokenKind::Identifier(ident),
                }
            }

            c => TokenKind::Unknown(c),
        };

        let text: String = self.source[start..self.pos].iter().collect();
        Token {
            kind,
            span: self.make_span(start, start_line, start_col),
            text,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_circuit() {
        let source = "export circuit add(a: Uint<64>): Uint<64> { return a; }";
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize();
        assert!(tokens.len() > 5);
        assert_eq!(tokens[0].kind, TokenKind::Export);
        assert_eq!(tokens[1].kind, TokenKind::Circuit);
    }

    #[test]
    fn test_pragma() {
        let source = "pragma language_version >= 0.21;";
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize();
        assert_eq!(tokens[0].kind, TokenKind::Pragma);
        assert_eq!(tokens[1].kind, TokenKind::LanguageVersion);
    }
}
