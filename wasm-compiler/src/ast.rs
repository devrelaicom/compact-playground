use crate::token::Span;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Program {
    pub items: Vec<TopLevelItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum TopLevelItem {
    Pragma(PragmaDecl),
    Import(ImportDecl),
    Module(ModuleDecl),
    LedgerDecl(LedgerDecl),
    CircuitDecl(CircuitDecl),
    Comment(CommentNode),
}

#[derive(Debug, Clone, Serialize)]
pub struct PragmaDecl {
    pub span: Span,
    pub constraints: Vec<VersionConstraint>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionConstraint {
    pub op: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportDecl {
    pub span: Span,
    pub path: String,
    pub is_string_path: bool,
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleDecl {
    pub span: Span,
    pub name: String,
    pub items: Vec<TopLevelItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LedgerDecl {
    pub span: Span,
    pub exported: bool,
    pub name: String,
    pub type_annotation: TypeExpr,
}

#[derive(Debug, Clone, Serialize)]
pub struct CircuitDecl {
    pub span: Span,
    pub exported: bool,
    pub name: String,
    pub params: Vec<Param>,
    pub return_type: TypeExpr,
    pub body: Vec<Statement>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Param {
    pub name: String,
    pub type_annotation: TypeExpr,
    pub span: Span,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum TypeExpr {
    Named { name: String, span: Span },
    Generic { name: String, args: Vec<TypeExpr>, span: Span },
    Unit { span: Span },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum Statement {
    ConstDecl {
        name: String,
        value: Expr,
        span: Span,
    },
    Return {
        value: Option<Expr>,
        span: Span,
    },
    Assignment {
        target: Expr,
        value: Expr,
        span: Span,
    },
    ExprStatement {
        expr: Expr,
        span: Span,
    },
    If {
        condition: Expr,
        then_body: Vec<Statement>,
        else_body: Option<Vec<Statement>>,
        span: Span,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum Expr {
    IntLiteral { value: u64, span: Span },
    StringLiteral { value: String, span: Span },
    BoolLiteral { value: bool, span: Span },
    Identifier { name: String, span: Span },
    BinaryOp {
        op: BinOp,
        left: Box<Expr>,
        right: Box<Expr>,
        span: Span,
    },
    UnaryOp {
        op: UnaryOp,
        operand: Box<Expr>,
        span: Span,
    },
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
        span: Span,
    },
    MethodCall {
        object: Box<Expr>,
        method: String,
        args: Vec<Expr>,
        span: Span,
    },
    FieldAccess {
        object: Box<Expr>,
        field: String,
        span: Span,
    },
    Cast {
        expr: Box<Expr>,
        target_type: TypeExpr,
        span: Span,
    },
    Assert {
        condition: Box<Expr>,
        message: Option<Box<Expr>>,
        span: Span,
    },
    Disclose {
        expr: Box<Expr>,
        span: Span,
    },
    Grouped {
        expr: Box<Expr>,
        span: Span,
    },
}

#[derive(Debug, Clone, Serialize)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Neq,
    Lt,
    Gt,
    Lte,
    Gte,
    And,
    Or,
}

#[derive(Debug, Clone, Serialize)]
pub enum UnaryOp {
    Neg,
    Not,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommentNode {
    pub text: String,
    pub span: Span,
}
