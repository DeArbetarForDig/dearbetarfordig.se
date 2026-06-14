/**
 * @daf/ui — Hierarchy Chart
 *
 * Tree/Sankey view of municipal organization.
 * Full implementation uses D3-hierarchy at build time.
 * This module provides the data interface and basic SVG fallback.
 */

export {
  generateStructureTreeSVG,
  type OrgNode,
  type StructureTreeConfig,
} from '../../components/structure-tree'
