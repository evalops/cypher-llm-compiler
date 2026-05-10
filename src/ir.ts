export type CypherDialect = "neo4j-cypher-25" | "opencypher-9" | "gql" | string;

export type CypherProfile = "llm-safe-readonly" | "llm-safe-write" | "raw-compatible";

export type CypherType =
  | "ANY"
  | "BOOLEAN"
  | "INTEGER"
  | "FLOAT"
  | "STRING"
  | "DATE"
  | "LOCAL_TIME"
  | "ZONED_TIME"
  | "LOCAL_DATETIME"
  | "ZONED_DATETIME"
  | "DURATION"
  | "POINT"
  | `LIST<${string}>`
  | `MAP<${string}>`
  | string;

export type JsonLiteral =
  | string
  | number
  | boolean
  | null
  | JsonLiteral[]
  | { [key: string]: JsonLiteral };

export interface SchemaProperty {
  type: CypherType;
  nullable?: boolean;
  aliases?: string[];
  description?: string;
  sampleValues?: JsonLiteral[];
}

export interface SchemaParameter {
  type: CypherType;
  required?: boolean;
  description?: string;
}

export interface SchemaNode {
  name: string;
  aliases?: string[];
  description?: string;
  properties?: Record<string, SchemaProperty>;
}

export interface SchemaRelationship {
  type: string;
  from: string | string[];
  to: string | string[];
  directed?: boolean;
  aliases?: string[];
  description?: string;
  properties?: Record<string, SchemaProperty>;
}

export interface SchemaProcedure {
  description?: string;
  arguments?: Record<string, CypherType | SchemaParameter>;
  yields?: Record<string, CypherType | SchemaProperty>;
}

export interface SchemaFunction {
  description?: string;
  arguments?: Record<string, CypherType | SchemaParameter>;
  returns?: CypherType | SchemaProperty;
}

export interface PathTemplateStep {
  from: string;
  relationship: string;
  to: string;
  direction?: RelationshipDirection;
  minHops?: number;
  maxHops?: number;
}

export interface PathTemplate {
  name: string;
  description?: string;
  steps: PathTemplateStep[];
}

export interface CypherSchemaContract {
  version: "cypher-llm-schema/v1";
  dialect?: CypherDialect;
  nodes: SchemaNode[];
  relationships: SchemaRelationship[];
  parameters?: Record<string, CypherType | SchemaParameter>;
  procedures?: Record<string, SchemaProcedure>;
  functions?: Record<string, SchemaFunction>;
  pathTemplates?: PathTemplate[];
  disallowWritesByDefault?: boolean;
}

export interface CypherQuery {
  version: "cypher-llm-ir/v1";
  profile?: CypherProfile;
  clauses: Clause[];
  metadata?: Record<string, JsonLiteral>;
}

export type Clause =
  | MatchClause
  | UnwindClause
  | LetClause
  | WithClause
  | ReturnClause
  | CallClause
  | CreateClause
  | MergeClause
  | DeleteClause
  | SetClause
  | RawClause;

export type ReadClause = MatchClause | UnwindClause | LetClause | WithClause | ReturnClause | CallClause;

export type WriteClause = CreateClause | MergeClause | DeleteClause | SetClause;

export interface MatchClause {
  kind: "match";
  optional?: boolean;
  patterns: PathPattern[];
  where?: Expression;
}

export interface UnwindClause {
  kind: "unwind";
  expression: Expression;
  alias: string;
}

export interface LetClause {
  kind: "let";
  bindings: Binding[];
}

export interface WithClause {
  kind: "with";
  distinct?: boolean;
  includeExisting?: boolean;
  items: ProjectionItem[];
  where?: Expression;
  orderBy?: OrderItem[];
  skip?: Expression;
  limit?: Expression;
}

export interface ReturnClause {
  kind: "return";
  distinct?: boolean;
  items: ProjectionItem[];
  orderBy?: OrderItem[];
  skip?: Expression;
  limit?: Expression;
}

export interface CallClause {
  kind: "call";
  procedure?: string;
  arguments?: Expression[];
  yield?: ProjectionItem[];
  where?: Expression;
  subquery?: CypherQuery;
  import?: string[];
}

export interface CreateClause {
  kind: "create";
  patterns: PathPattern[];
}

export interface MergeClause {
  kind: "merge";
  pattern: PathPattern;
  onCreate?: SetItem[];
  onMatch?: SetItem[];
}

export interface DeleteClause {
  kind: "delete";
  detach?: boolean;
  expressions: Expression[];
}

export interface SetClause {
  kind: "set";
  items: SetItem[];
}

export interface RawClause {
  kind: "raw";
  cypher: string;
  reason?: string;
}

export interface Binding {
  alias: string;
  expression: Expression;
}

export interface ProjectionItem {
  expression: Expression;
  alias?: string;
}

export interface OrderItem {
  expression: Expression;
  direction?: "ASC" | "DESC";
}

export interface SetItem {
  target: Expression;
  value: Expression;
  operator?: "=" | "+=";
}

export interface PathPattern {
  name?: string;
  mode?: "walk" | "trail" | "acyclic";
  shortest?: "any" | "all";
  segments: [NodePattern, ...PathContinuation[]];
}

export interface PathContinuation {
  rel: RelationshipPattern;
  node: NodePattern;
}

export interface NodePattern {
  variable?: string;
  labels?: string[];
  properties?: Record<string, Expression>;
  where?: Expression;
}

export type RelationshipDirection = "out" | "in" | "undirected";

export interface RelationshipPattern {
  variable?: string;
  types?: string[];
  direction?: RelationshipDirection;
  minHops?: number;
  maxHops?: number | null;
  properties?: Record<string, Expression>;
  where?: Expression;
}

export type BinaryOperator =
  | "OR"
  | "XOR"
  | "AND"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "IN"
  | "CONTAINS"
  | "STARTS WITH"
  | "ENDS WITH"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^";

export type UnaryOperator = "NOT" | "+" | "-";

export type Expression =
  | VariableExpression
  | PropertyExpression
  | ParameterExpression
  | LiteralExpression
  | BinaryExpression
  | UnaryExpression
  | FunctionExpression
  | ListExpression
  | MapExpression
  | CaseExpression
  | RawExpression;

export interface VariableExpression {
  kind: "var";
  name: string;
}

export interface PropertyExpression {
  kind: "prop";
  object: Expression;
  key: string;
}

export interface ParameterExpression {
  kind: "param";
  name: string;
}

export interface LiteralExpression {
  kind: "literal";
  value: JsonLiteral;
}

export interface BinaryExpression {
  kind: "binary";
  op: BinaryOperator;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression {
  kind: "unary";
  op: UnaryOperator;
  expression: Expression;
}

export interface FunctionExpression {
  kind: "function";
  name: string;
  distinct?: boolean;
  arguments: Expression[];
}

export interface ListExpression {
  kind: "list";
  items: Expression[];
}

export interface MapExpression {
  kind: "map";
  entries: Record<string, Expression>;
}

export interface CaseWhen {
  when: Expression;
  then: Expression;
}

export interface CaseExpression {
  kind: "case";
  expression?: Expression;
  cases: CaseWhen[];
  else?: Expression;
}

export interface RawExpression {
  kind: "raw";
  cypher: string;
  reason?: string;
}

export function literal(value: JsonLiteral): LiteralExpression {
  return { kind: "literal", value };
}

export function variable(name: string): VariableExpression {
  return { kind: "var", name };
}

export function param(name: string): ParameterExpression {
  return { kind: "param", name };
}

export function prop(object: Expression, key: string): PropertyExpression {
  return { kind: "prop", object, key };
}
