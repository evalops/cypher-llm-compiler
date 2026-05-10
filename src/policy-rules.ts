export type CypherPolicyRuleSeverity = "info" | "warning" | "error";

export interface CypherSensitiveLabelRule {
  label: string;
  severity?: CypherPolicyRuleSeverity;
  reason?: string;
}

export interface CypherSensitiveRelationshipRule {
  type: string;
  severity?: CypherPolicyRuleSeverity;
  reason?: string;
}

export interface CypherSensitivePropertyRule {
  ownerKind?: "node" | "relationship" | "any";
  owner?: string;
  property: string;
  severity?: CypherPolicyRuleSeverity;
  reason?: string;
}

export interface CypherTenantScopeRule {
  label: string;
  property: string;
  parameter?: string;
  severity?: CypherPolicyRuleSeverity;
  reason?: string;
}

export interface CypherPolicyRuleSet {
  version: "cypher-llm-policy-rules/v1";
  id: string;
  title?: string;
  sensitiveLabels?: CypherSensitiveLabelRule[];
  sensitiveRelationships?: CypherSensitiveRelationshipRule[];
  sensitiveProperties?: CypherSensitivePropertyRule[];
  tenantScopes?: CypherTenantScopeRule[];
}

export interface CypherPolicyRuleSetSummary {
  id: string;
  title?: string;
  sensitiveLabels: number;
  sensitiveRelationships: number;
  sensitiveProperties: number;
  tenantScopes: number;
}

export function summarizePolicyRules(ruleSet: CypherPolicyRuleSet): CypherPolicyRuleSetSummary {
  return {
    id: ruleSet.id,
    ...(ruleSet.title ? { title: ruleSet.title } : {}),
    sensitiveLabels: ruleSet.sensitiveLabels?.length ?? 0,
    sensitiveRelationships: ruleSet.sensitiveRelationships?.length ?? 0,
    sensitiveProperties: ruleSet.sensitiveProperties?.length ?? 0,
    tenantScopes: ruleSet.tenantScopes?.length ?? 0
  };
}
