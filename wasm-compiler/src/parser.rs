use crate::ast::*;
use crate::token::{Span, Token, TokenKind};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
    pub column: usize,
    pub span: Option<Span>,
}

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    errors: Vec<ParseError>,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self {
            tokens,
            pos: 0,
            errors: Vec::new(),
        }
    }

    pub fn parse(mut self) -> (Program, Vec<ParseError>) {
        let mut items = Vec::new();

        while !self.is_at_end() {
            match self.parse_top_level_item() {
                Some(item) => items.push(item),
                None => {
                    // Skip to next potential start token
                    self.advance();
                }
            }
        }

        (Program { items }, self.errors)
    }

    // --- Token helpers ---

    fn peek(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or(&self.tokens[self.tokens.len() - 1])
    }

    fn peek_kind(&self) -> &TokenKind {
        &self.peek().kind
    }

    fn advance(&mut self) -> &Token {
        let token = &self.tokens[self.pos.min(self.tokens.len() - 1)];
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        token
    }

    fn is_at_end(&self) -> bool {
        matches!(self.peek_kind(), TokenKind::Eof)
    }

    fn check(&self, kind: &TokenKind) -> bool {
        std::mem::discriminant(self.peek_kind()) == std::mem::discriminant(kind)
    }

    fn expect(&mut self, kind: &TokenKind) -> Option<Token> {
        if self.check(kind) {
            Some(self.advance().clone())
        } else {
            let tok = self.peek().clone();
            self.errors.push(ParseError {
                message: format!("Expected {:?}, got {:?}", kind, tok.kind),
                line: tok.span.line,
                column: tok.span.column,
                span: Some(tok.span),
            });
            None
        }
    }

    fn current_span(&self) -> Span {
        self.peek().span.clone()
    }

    fn error(&mut self, msg: &str) {
        let span = self.current_span();
        self.errors.push(ParseError {
            message: msg.to_string(),
            line: span.line,
            column: span.column,
            span: Some(span),
        });
    }

    // --- Top-level parsing ---

    fn parse_top_level_item(&mut self) -> Option<TopLevelItem> {
        // Skip comments
        if let TokenKind::Comment(text) = self.peek_kind().clone() {
            let span = self.current_span();
            self.advance();
            return Some(TopLevelItem::Comment(CommentNode { text, span }));
        }

        match self.peek_kind().clone() {
            TokenKind::Pragma => self.parse_pragma(),
            TokenKind::Import => self.parse_import(),
            TokenKind::Module => self.parse_module(),
            TokenKind::Export => self.parse_exported_item(),
            TokenKind::Ledger => self.parse_ledger(false),
            TokenKind::Circuit => self.parse_circuit(false),
            _ => {
                self.error(&format!("Unexpected token: {:?}", self.peek_kind()));
                None
            }
        }
    }

    fn parse_pragma(&mut self) -> Option<TopLevelItem> {
        let start = self.current_span();
        self.advance(); // consume 'pragma'

        // Expect 'language_version'
        if !self.check(&TokenKind::LanguageVersion) {
            self.error("Expected 'language_version' after 'pragma'");
            self.skip_to_semicolon();
            return None;
        }
        self.advance();

        let mut constraints = Vec::new();

        loop {
            let op = match self.peek_kind() {
                TokenKind::Gte => ">=".to_string(),
                TokenKind::Lte => "<=".to_string(),
                TokenKind::Gt => ">".to_string(),
                TokenKind::Lt => "<".to_string(),
                TokenKind::Eq => "==".to_string(),
                _ => break,
            };
            self.advance();

            let version = match self.peek_kind() {
                TokenKind::Identifier(v) => v.clone(),
                TokenKind::IntLiteral(n) => n.to_string(),
                _ => {
                    self.error("Expected version number");
                    break;
                }
            };
            self.advance();

            constraints.push(VersionConstraint { op, version });

            // Check for && connector
            if matches!(self.peek_kind(), TokenKind::And) {
                self.advance();
            } else {
                break;
            }
        }

        self.expect(&TokenKind::Semicolon);

        Some(TopLevelItem::Pragma(PragmaDecl {
            span: start,
            constraints,
        }))
    }

    fn parse_import(&mut self) -> Option<TopLevelItem> {
        let start = self.current_span();
        self.advance(); // consume 'import'

        let (path, is_string_path) = match self.peek_kind().clone() {
            TokenKind::StringLiteral(s) => {
                self.advance();
                (s, true)
            }
            TokenKind::Identifier(name) => {
                self.advance();
                (name, false)
            }
            _ => {
                self.error("Expected module name or path string after 'import'");
                self.skip_to_semicolon();
                return None;
            }
        };

        let prefix = if matches!(self.peek_kind(), TokenKind::Prefix) {
            self.advance();
            match self.peek_kind().clone() {
                TokenKind::Identifier(name) => {
                    self.advance();
                    Some(name)
                }
                _ => {
                    self.error("Expected prefix name");
                    None
                }
            }
        } else {
            None
        };

        self.expect(&TokenKind::Semicolon);

        Some(TopLevelItem::Import(ImportDecl {
            span: start,
            path,
            is_string_path,
            prefix,
        }))
    }

    fn parse_module(&mut self) -> Option<TopLevelItem> {
        let start = self.current_span();
        self.advance(); // consume 'module'

        let name = match self.peek_kind().clone() {
            TokenKind::Identifier(name) => {
                self.advance();
                name
            }
            _ => {
                self.error("Expected module name");
                return None;
            }
        };

        self.expect(&TokenKind::LBrace);

        let mut items = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RBrace | TokenKind::Eof) {
            match self.parse_top_level_item() {
                Some(item) => items.push(item),
                None => {
                    self.advance();
                }
            }
        }

        self.expect(&TokenKind::RBrace);

        Some(TopLevelItem::Module(ModuleDecl {
            span: start,
            name,
            items,
        }))
    }

    fn parse_exported_item(&mut self) -> Option<TopLevelItem> {
        self.advance(); // consume 'export'

        match self.peek_kind().clone() {
            TokenKind::Ledger => self.parse_ledger(true),
            TokenKind::Circuit => self.parse_circuit(true),
            _ => {
                self.error("Expected 'ledger' or 'circuit' after 'export'");
                None
            }
        }
    }

    fn parse_ledger(&mut self, exported: bool) -> Option<TopLevelItem> {
        let start = self.current_span();
        self.advance(); // consume 'ledger'

        let name = match self.peek_kind().clone() {
            TokenKind::Identifier(name) => {
                self.advance();
                name
            }
            _ => {
                self.error("Expected ledger name");
                self.skip_to_semicolon();
                return None;
            }
        };

        self.expect(&TokenKind::Colon);
        let type_annotation = self.parse_type()?;
        self.expect(&TokenKind::Semicolon);

        Some(TopLevelItem::LedgerDecl(LedgerDecl {
            span: start,
            exported,
            name,
            type_annotation,
        }))
    }

    fn parse_circuit(&mut self, exported: bool) -> Option<TopLevelItem> {
        let start = self.current_span();
        self.advance(); // consume 'circuit'

        let name = match self.peek_kind().clone() {
            TokenKind::Identifier(name) => {
                self.advance();
                name
            }
            _ => {
                self.error("Expected circuit name");
                return None;
            }
        };

        self.expect(&TokenKind::LParen);
        let params = self.parse_params();
        self.expect(&TokenKind::RParen);

        self.expect(&TokenKind::Colon);
        let return_type = self.parse_type()?;

        self.expect(&TokenKind::LBrace);
        let body = self.parse_block();
        self.expect(&TokenKind::RBrace);

        Some(TopLevelItem::CircuitDecl(CircuitDecl {
            span: start,
            exported,
            name,
            params,
            return_type,
            body,
        }))
    }

    // --- Type parsing ---

    fn parse_type(&mut self) -> Option<TypeExpr> {
        let span = self.current_span();

        // Unit type: []
        if matches!(self.peek_kind(), TokenKind::LBracket) {
            self.advance();
            self.expect(&TokenKind::RBracket);
            return Some(TypeExpr::Unit { span });
        }

        let name = match self.peek_kind().clone() {
            TokenKind::Identifier(name) => {
                self.advance();
                name
            }
            _ => {
                self.error("Expected type name");
                return None;
            }
        };

        // Check for generic params <...>
        if matches!(self.peek_kind(), TokenKind::Lt) {
            self.advance(); // consume <
            let mut args = Vec::new();

            // Handle Uint<64> style (number as type arg)
            loop {
                if matches!(self.peek_kind(), TokenKind::Gt) {
                    break;
                }

                if let TokenKind::IntLiteral(n) = self.peek_kind().clone() {
                    let arg_span = self.current_span();
                    self.advance();
                    args.push(TypeExpr::Named {
                        name: n.to_string(),
                        span: arg_span,
                    });
                } else {
                    match self.parse_type() {
                        Some(t) => args.push(t),
                        None => break,
                    }
                }

                if matches!(self.peek_kind(), TokenKind::Comma) {
                    self.advance();
                } else {
                    break;
                }
            }

            self.expect(&TokenKind::Gt);
            Some(TypeExpr::Generic { name, args, span })
        } else {
            Some(TypeExpr::Named { name, span })
        }
    }

    // --- Parameter parsing ---

    fn parse_params(&mut self) -> Vec<Param> {
        let mut params = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RParen | TokenKind::Eof) {
            let span = self.current_span();
            let name = match self.peek_kind().clone() {
                TokenKind::Identifier(name) => {
                    self.advance();
                    name
                }
                _ => break,
            };

            if self.expect(&TokenKind::Colon).is_none() {
                break;
            }

            match self.parse_type() {
                Some(type_annotation) => {
                    params.push(Param {
                        name,
                        type_annotation,
                        span,
                    });
                }
                None => break,
            }

            if matches!(self.peek_kind(), TokenKind::Comma) {
                self.advance();
            } else {
                break;
            }
        }
        params
    }

    // --- Statement parsing ---

    fn parse_block(&mut self) -> Vec<Statement> {
        let mut stmts = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RBrace | TokenKind::Eof) {
            // Skip comments in blocks
            if let TokenKind::Comment(_) = self.peek_kind() {
                self.advance();
                continue;
            }
            match self.parse_statement() {
                Some(stmt) => stmts.push(stmt),
                None => {
                    self.advance();
                }
            }
        }
        stmts
    }

    fn parse_statement(&mut self) -> Option<Statement> {
        let span = self.current_span();

        match self.peek_kind().clone() {
            TokenKind::Const => {
                self.advance();
                let name = match self.peek_kind().clone() {
                    TokenKind::Identifier(n) => {
                        self.advance();
                        n
                    }
                    _ => {
                        self.error("Expected variable name after 'const'");
                        return None;
                    }
                };
                self.expect(&TokenKind::Assign);
                let value = self.parse_expression()?;
                self.expect(&TokenKind::Semicolon);
                Some(Statement::ConstDecl { name, value, span })
            }
            TokenKind::Return => {
                self.advance();
                let value = if matches!(self.peek_kind(), TokenKind::Semicolon) {
                    None
                } else {
                    Some(self.parse_expression()?)
                };
                self.expect(&TokenKind::Semicolon);
                Some(Statement::Return { value, span })
            }
            TokenKind::If => {
                self.advance();
                self.expect(&TokenKind::LParen);
                let condition = self.parse_expression()?;
                self.expect(&TokenKind::RParen);
                self.expect(&TokenKind::LBrace);
                let then_body = self.parse_block();
                self.expect(&TokenKind::RBrace);
                let else_body = if matches!(self.peek_kind(), TokenKind::Else) {
                    self.advance();
                    self.expect(&TokenKind::LBrace);
                    let body = self.parse_block();
                    self.expect(&TokenKind::RBrace);
                    Some(body)
                } else {
                    None
                };
                Some(Statement::If {
                    condition,
                    then_body,
                    else_body,
                    span,
                })
            }
            _ => {
                let expr = self.parse_expression()?;

                // Check for assignment
                if matches!(self.peek_kind(), TokenKind::Assign) {
                    self.advance();
                    let value = self.parse_expression()?;
                    self.expect(&TokenKind::Semicolon);
                    Some(Statement::Assignment {
                        target: expr,
                        value,
                        span,
                    })
                } else {
                    self.expect(&TokenKind::Semicolon);
                    Some(Statement::ExprStatement { expr, span })
                }
            }
        }
    }

    // --- Expression parsing (precedence climbing) ---

    fn parse_expression(&mut self) -> Option<Expr> {
        self.parse_or_expr()
    }

    fn parse_or_expr(&mut self) -> Option<Expr> {
        let mut left = self.parse_and_expr()?;
        while matches!(self.peek_kind(), TokenKind::Or) {
            let span = self.current_span();
            self.advance();
            let right = self.parse_and_expr()?;
            left = Expr::BinaryOp {
                op: BinOp::Or,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Some(left)
    }

    fn parse_and_expr(&mut self) -> Option<Expr> {
        let mut left = self.parse_comparison()?;
        while matches!(self.peek_kind(), TokenKind::And) {
            let span = self.current_span();
            self.advance();
            let right = self.parse_comparison()?;
            left = Expr::BinaryOp {
                op: BinOp::And,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Some(left)
    }

    fn parse_comparison(&mut self) -> Option<Expr> {
        let mut left = self.parse_additive()?;
        loop {
            let (op, span) = match self.peek_kind() {
                TokenKind::Eq => (BinOp::Eq, self.current_span()),
                TokenKind::Neq => (BinOp::Neq, self.current_span()),
                TokenKind::Lt => (BinOp::Lt, self.current_span()),
                TokenKind::Gt => (BinOp::Gt, self.current_span()),
                TokenKind::Lte => (BinOp::Lte, self.current_span()),
                TokenKind::Gte => (BinOp::Gte, self.current_span()),
                _ => break,
            };
            self.advance();
            let right = self.parse_additive()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Some(left)
    }

    fn parse_additive(&mut self) -> Option<Expr> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let (op, span) = match self.peek_kind() {
                TokenKind::Plus => (BinOp::Add, self.current_span()),
                TokenKind::Minus => (BinOp::Sub, self.current_span()),
                _ => break,
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Some(left)
    }

    fn parse_multiplicative(&mut self) -> Option<Expr> {
        let mut left = self.parse_cast()?;
        loop {
            let (op, span) = match self.peek_kind() {
                TokenKind::Star => (BinOp::Mul, self.current_span()),
                TokenKind::Slash => (BinOp::Div, self.current_span()),
                TokenKind::Percent => (BinOp::Mod, self.current_span()),
                _ => break,
            };
            self.advance();
            let right = self.parse_cast()?;
            left = Expr::BinaryOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
                span,
            };
        }
        Some(left)
    }

    fn parse_cast(&mut self) -> Option<Expr> {
        let mut expr = self.parse_unary()?;
        while matches!(self.peek_kind(), TokenKind::As) {
            let span = self.current_span();
            self.advance();
            let target_type = self.parse_type()?;
            expr = Expr::Cast {
                expr: Box::new(expr),
                target_type,
                span,
            };
        }
        Some(expr)
    }

    fn parse_unary(&mut self) -> Option<Expr> {
        let span = self.current_span();
        match self.peek_kind().clone() {
            TokenKind::Minus => {
                self.advance();
                let operand = self.parse_postfix()?;
                Some(Expr::UnaryOp {
                    op: UnaryOp::Neg,
                    operand: Box::new(operand),
                    span,
                })
            }
            TokenKind::Not => {
                self.advance();
                let operand = self.parse_postfix()?;
                Some(Expr::UnaryOp {
                    op: UnaryOp::Not,
                    operand: Box::new(operand),
                    span,
                })
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> Option<Expr> {
        let mut expr = self.parse_primary()?;

        loop {
            match self.peek_kind() {
                TokenKind::Dot => {
                    let span = self.current_span();
                    self.advance();
                    let field = match self.peek_kind().clone() {
                        TokenKind::Identifier(name) => {
                            self.advance();
                            name
                        }
                        _ => {
                            self.error("Expected field name after '.'");
                            break;
                        }
                    };

                    // Check if it's a method call
                    if matches!(self.peek_kind(), TokenKind::LParen) {
                        self.advance();
                        let args = self.parse_call_args();
                        self.expect(&TokenKind::RParen);
                        expr = Expr::MethodCall {
                            object: Box::new(expr),
                            method: field,
                            args,
                            span,
                        };
                    } else {
                        expr = Expr::FieldAccess {
                            object: Box::new(expr),
                            field,
                            span,
                        };
                    }
                }
                TokenKind::LParen => {
                    let span = self.current_span();
                    self.advance();
                    let args = self.parse_call_args();
                    self.expect(&TokenKind::RParen);
                    expr = Expr::Call {
                        callee: Box::new(expr),
                        args,
                        span,
                    };
                }
                _ => break,
            }
        }

        Some(expr)
    }

    fn parse_primary(&mut self) -> Option<Expr> {
        let span = self.current_span();

        match self.peek_kind().clone() {
            TokenKind::IntLiteral(n) => {
                self.advance();
                Some(Expr::IntLiteral { value: n, span })
            }
            TokenKind::StringLiteral(s) => {
                self.advance();
                Some(Expr::StringLiteral { value: s, span })
            }
            TokenKind::BoolLiteral(b) => {
                self.advance();
                Some(Expr::BoolLiteral { value: b, span })
            }
            TokenKind::Assert => {
                self.advance();
                self.expect(&TokenKind::LParen);
                let condition = self.parse_expression()?;
                let message = if matches!(self.peek_kind(), TokenKind::Comma) {
                    self.advance();
                    Some(Box::new(self.parse_expression()?))
                } else {
                    None
                };
                self.expect(&TokenKind::RParen);
                Some(Expr::Assert {
                    condition: Box::new(condition),
                    message,
                    span,
                })
            }
            TokenKind::Disclose => {
                self.advance();
                self.expect(&TokenKind::LParen);
                let expr = self.parse_expression()?;
                self.expect(&TokenKind::RParen);
                Some(Expr::Disclose {
                    expr: Box::new(expr),
                    span,
                })
            }
            TokenKind::Identifier(name) => {
                self.advance();
                Some(Expr::Identifier { name, span })
            }
            TokenKind::LParen => {
                self.advance();
                let expr = self.parse_expression()?;
                self.expect(&TokenKind::RParen);
                Some(Expr::Grouped {
                    expr: Box::new(expr),
                    span,
                })
            }
            _ => {
                self.error(&format!("Unexpected token in expression: {:?}", self.peek_kind()));
                None
            }
        }
    }

    fn parse_call_args(&mut self) -> Vec<Expr> {
        let mut args = Vec::new();
        while !matches!(self.peek_kind(), TokenKind::RParen | TokenKind::Eof) {
            match self.parse_expression() {
                Some(expr) => args.push(expr),
                None => break,
            }
            if matches!(self.peek_kind(), TokenKind::Comma) {
                self.advance();
            } else {
                break;
            }
        }
        args
    }

    // --- Error recovery ---

    fn skip_to_semicolon(&mut self) {
        while !matches!(self.peek_kind(), TokenKind::Semicolon | TokenKind::Eof) {
            self.advance();
        }
        if matches!(self.peek_kind(), TokenKind::Semicolon) {
            self.advance();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::Lexer;

    fn parse(source: &str) -> (Program, Vec<ParseError>) {
        let mut lexer = Lexer::new(source);
        let tokens = lexer.tokenize();
        Parser::new(tokens).parse()
    }

    #[test]
    fn test_parse_pragma() {
        let (prog, errors) = parse("pragma language_version >= 0.21;");
        assert!(errors.is_empty(), "errors: {:?}", errors);
        assert_eq!(prog.items.len(), 1);
    }

    #[test]
    fn test_parse_import() {
        let (prog, errors) = parse("import CompactStandardLibrary;");
        assert!(errors.is_empty(), "errors: {:?}", errors);
        assert_eq!(prog.items.len(), 1);
    }

    #[test]
    fn test_parse_circuit() {
        let (prog, errors) = parse(
            r#"export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
                return (a + b) as Uint<64>;
            }"#,
        );
        assert!(errors.is_empty(), "errors: {:?}", errors);
        assert_eq!(prog.items.len(), 1);
    }

    #[test]
    fn test_parse_ledger() {
        let (prog, errors) = parse("export ledger counter: Counter;");
        assert!(errors.is_empty(), "errors: {:?}", errors);
        assert_eq!(prog.items.len(), 1);
    }

    #[test]
    fn test_parse_full_program() {
        let source = r#"
            pragma language_version >= 0.21;
            import CompactStandardLibrary;
            export ledger counter: Counter;
            export circuit increment(): [] {
                counter.increment(1);
            }
        "#;
        let (prog, errors) = parse(source);
        assert!(errors.is_empty(), "errors: {:?}", errors);
        assert_eq!(prog.items.len(), 4);
    }
}
