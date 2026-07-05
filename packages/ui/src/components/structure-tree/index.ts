/**
 * @daf/ui — Structure Tree
 *
 * Visualizes municipal organization hierarchy.
 * Each node has a formal name and a plain-language explanation.
 */

export interface OrgNode {
  id: string
  namn: string
  förklaring: string
  ledamöter: number
  children?: OrgNode[]
  url?: string
}

export interface StructureTreeConfig {
  root: OrgNode
  maxDepth?: number
}

export function generateStructureTreeSVG(config: StructureTreeConfig): string {
  const { root, maxDepth = 3 } = config
  // Placeholder — full D3-hierarchy implementation at build time
  const nodes = flattenTree(root, 0, maxDepth)

  const nodeElements = nodes
    .map(
      ({ node, depth, index }) => `
    <g class="daf-org-node" data-depth="${depth}">
      <rect x="${index * 160 + 10}" y="${depth * 100 + 10}" width="140" height="70" rx="8" class="daf-org-node__box daf-org-node__box--${Math.min(depth, 2)}" />
      <text x="${index * 160 + 80}" y="${depth * 100 + 40}" text-anchor="middle" class="inverse" font-size="11" font-weight="bold">${node.namn}</text>
      <text x="${index * 160 + 80}" y="${depth * 100 + 58}" text-anchor="middle" class="inverse" font-size="9" opacity="0.8">${node.förklaring}</text>
    </g>`,
    )
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${nodes.length * 160 + 20} ${maxDepth * 100 + 90}" role="img" aria-label="Göteborgs kommunorganisation">
  ${nodeElements}
</svg>`
}

function flattenTree(
  node: OrgNode,
  depth: number,
  maxDepth: number,
  result: { node: OrgNode; depth: number; index: number }[] = [],
): { node: OrgNode; depth: number; index: number }[] {
  result.push({ node, depth, index: result.length })
  if (depth < maxDepth && node.children) {
    for (const child of node.children) {
      flattenTree(child, depth + 1, maxDepth, result)
    }
  }
  return result
}
