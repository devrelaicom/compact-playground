use crate::ast::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisResult {
    pub diagnostics: Vec<Diagnostic>,
    pub summary: ProgramSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgramSummary {
    pub has_pragma: bool,
    pub pragma_version: Option<String>,
    pub imports: Vec<String>,
    pub ledger_fields: Vec<LedgerInfo>,
    pub circuits: Vec<CircuitInfo>,
    pub modules: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LedgerInfo {
    pub name: String,
    pub type_name: String,
    pub exported: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CircuitInfo {
    pub name: String,
    pub param_count: usize,
    pub return_type: String,
    pub exported: bool,
    pub has_assertions: bool,
    pub uses_disclose: bool,
}

pub struct Analyzer {
    diagnostics: Vec<Diagnostic>,
}

impl Analyzer {
    pub fn new() -> Self {
        Self {
            diagnostics: Vec::new(),
        }
    }

    pub fn analyze(mut self, program: &Program) -> AnalysisResult {
        let mut summary = ProgramSummary {
            has_pragma: false,
            pragma_version: None,
            imports: Vec::new(),
            ledger_fields: Vec::new(),
            circuits: Vec::new(),
            modules: Vec::new(),
        };

        self.analyze_items(&program.items, &mut summary);
        self.check_missing_pragma(&summary);
        self.check_missing_stdlib_import(&summary);

        AnalysisResult {
            diagnostics: self.diagnostics,
            summary,
        }
    }

    fn analyze_items(&mut self, items: &[TopLevelItem], summary: &mut ProgramSummary) {
        for item in items {
            match item {
                TopLevelItem::Pragma(pragma) => {
                    summary.has_pragma = true;
                    if let Some(first) = pragma.constraints.first() {
                        summary.pragma_version = Some(first.version.clone());
                    }
                }
                TopLevelItem::Import(import) => {
                    summary.imports.push(import.path.clone());
                }
                TopLevelItem::Module(module) => {
                    summary.modules.push(module.name.clone());
                    self.analyze_items(&module.items, summary);
                }
                TopLevelItem::LedgerDecl(ledger) => {
                    summary.ledger_fields.push(LedgerInfo {
                        name: ledger.name.clone(),
                        type_name: type_to_string(&ledger.type_annotation),
                        exported: ledger.exported,
                    });
                    self.check_ledger(ledger);
                }
                TopLevelItem::CircuitDecl(circuit) => {
                    let mut has_assertions = false;
                    let mut uses_disclose = false;
                    self.scan_circuit_body(&circuit.body, &mut has_assertions, &mut uses_disclose);

                    summary.circuits.push(CircuitInfo {
                        name: circuit.name.clone(),
                        param_count: circuit.params.len(),
                        return_type: type_to_string(&circuit.return_type),
                        exported: circuit.exported,
                        has_assertions,
                        uses_disclose,
                    });
                    self.check_circuit(circuit);
                }
                TopLevelItem::Comment(_) => {}
            }
        }
    }

    fn check_missing_pragma(&mut self, summary: &ProgramSummary) {
        if !summary.has_pragma {
            self.diagnostics.push(Diagnostic {
                severity: Severity::Warning,
                message: "Missing pragma declaration. Consider adding: pragma language_version >= 0.21;".to_string(),
                line: 1,
                column: 1,
            });
        }
    }

    fn check_missing_stdlib_import(&mut self, summary: &ProgramSummary) {
        let has_stdlib = summary.imports.iter().any(|i| i == "CompactStandardLibrary");
        let has_ledger = !summary.ledger_fields.is_empty();
        let has_circuits = !summary.circuits.is_empty();

        if !has_stdlib && (has_ledger || has_circuits) {
            self.diagnostics.push(Diagnostic {
                severity: Severity::Warning,
                message: "Missing standard library import. Consider adding: import CompactStandardLibrary;".to_string(),
                line: 1,
                column: 1,
            });
        }
    }

    fn check_ledger(&mut self, ledger: &LedgerDecl) {
        if !ledger.exported {
            self.diagnostics.push(Diagnostic {
                severity: Severity::Info,
                message: format!("Ledger field '{}' is not exported. Consider adding 'export' if it should be accessible.", ledger.name),
                line: ledger.span.line,
                column: ledger.span.column,
            });
        }
    }

    fn check_circuit(&mut self, circuit: &CircuitDecl) {
        if !circuit.exported {
            self.diagnostics.push(Diagnostic {
                severity: Severity::Info,
                message: format!("Circuit '{}' is not exported. Consider adding 'export' if it should be callable.", circuit.name),
                line: circuit.span.line,
                column: circuit.span.column,
            });
        }

        // Check for return statement in non-void circuits
        if !matches!(&circuit.return_type, TypeExpr::Unit { .. }) {
            let has_return = circuit.body.iter().any(|s| matches!(s, Statement::Return { .. }));
            if !has_return {
                self.diagnostics.push(Diagnostic {
                    severity: Severity::Error,
                    message: format!(
                        "Circuit '{}' has return type '{}' but no return statement.",
                        circuit.name,
                        type_to_string(&circuit.return_type)
                    ),
                    line: circuit.span.line,
                    column: circuit.span.column,
                });
            }
        }
    }

    fn scan_circuit_body(&self, stmts: &[Statement], has_assertions: &mut bool, uses_disclose: &mut bool) {
        for stmt in stmts {
            match stmt {
                Statement::ExprStatement { expr, .. } | Statement::Return { value: Some(expr), .. } => {
                    self.scan_expr(expr, has_assertions, uses_disclose);
                }
                Statement::ConstDecl { value, .. } => {
                    self.scan_expr(value, has_assertions, uses_disclose);
                }
                Statement::Assignment { value, target, .. } => {
                    self.scan_expr(target, has_assertions, uses_disclose);
                    self.scan_expr(value, has_assertions, uses_disclose);
                }
                Statement::If { condition, then_body, else_body, .. } => {
                    self.scan_expr(condition, has_assertions, uses_disclose);
                    self.scan_circuit_body(then_body, has_assertions, uses_disclose);
                    if let Some(else_stmts) = else_body {
                        self.scan_circuit_body(else_stmts, has_assertions, uses_disclose);
                    }
                }
                _ => {}
            }
        }
    }

    fn scan_expr(&self, expr: &Expr, has_assertions: &mut bool, uses_disclose: &mut bool) {
        match expr {
            Expr::Assert { condition, message, .. } => {
                *has_assertions = true;
                self.scan_expr(condition, has_assertions, uses_disclose);
                if let Some(msg) = message {
                    self.scan_expr(msg, has_assertions, uses_disclose);
                }
            }
            Expr::Disclose { expr: inner, .. } => {
                *uses_disclose = true;
                self.scan_expr(inner, has_assertions, uses_disclose);
            }
            Expr::BinaryOp { left, right, .. } => {
                self.scan_expr(left, has_assertions, uses_disclose);
                self.scan_expr(right, has_assertions, uses_disclose);
            }
            Expr::UnaryOp { operand, .. } => {
                self.scan_expr(operand, has_assertions, uses_disclose);
            }
            Expr::Call { callee, args, .. } => {
                self.scan_expr(callee, has_assertions, uses_disclose);
                for arg in args {
                    self.scan_expr(arg, has_assertions, uses_disclose);
                }
            }
            Expr::MethodCall { object, args, .. } => {
                self.scan_expr(object, has_assertions, uses_disclose);
                for arg in args {
                    self.scan_expr(arg, has_assertions, uses_disclose);
                }
            }
            Expr::Cast { expr: inner, .. } | Expr::Grouped { expr: inner, .. } => {
                self.scan_expr(inner, has_assertions, uses_disclose);
            }
            Expr::FieldAccess { object, .. } => {
                self.scan_expr(object, has_assertions, uses_disclose);
            }
            _ => {}
        }
    }
}

fn type_to_string(t: &TypeExpr) -> String {
    match t {
        TypeExpr::Named { name, .. } => name.clone(),
        TypeExpr::Generic { name, args, .. } => {
            let args_str: Vec<String> = args.iter().map(type_to_string).collect();
            format!("{}<{}>", name, args_str.join(", "))
        }
        TypeExpr::Unit { .. } => "[]".to_string(),
    }
}
