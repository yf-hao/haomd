/**
 * Math symbol definitions for the Format > Math Symbols dialog.
 * Each item has a Unicode preview character and LaTeX code.
 */

export interface MathSymbolItem {
  /** Unicode preview character(s) */
  unicode: string
  /** LaTeX command to insert */
  latex: string
}

export interface MathCategory {
  /** Category key, matches Rust menu action suffix: format_math_cat_{key} */
  key: string
  nameZh: string
  nameEn: string
  items: MathSymbolItem[]
}

/** Menu action ID prefix for category-level actions */
export const MATH_CAT_PREFIX = 'format_math_cat_'

export const MATH_CATEGORIES: MathCategory[] = [
  {
    key: 'greek',
    nameZh: '希腊字母',
    nameEn: 'Greek Letters',
    items: [
      { unicode: 'α', latex: '\\alpha' },
      { unicode: 'β', latex: '\\beta' },
      { unicode: 'γ', latex: '\\gamma' },
      { unicode: 'δ', latex: '\\delta' },
      { unicode: 'ε', latex: '\\epsilon' },
      { unicode: 'ζ', latex: '\\zeta' },
      { unicode: 'η', latex: '\\eta' },
      { unicode: 'θ', latex: '\\theta' },
      { unicode: 'ι', latex: '\\iota' },
      { unicode: 'κ', latex: '\\kappa' },
      { unicode: 'λ', latex: '\\lambda' },
      { unicode: 'μ', latex: '\\mu' },
      { unicode: 'ν', latex: '\\nu' },
      { unicode: 'ξ', latex: '\\xi' },
      { unicode: 'π', latex: '\\pi' },
      { unicode: 'ρ', latex: '\\rho' },
      { unicode: 'σ', latex: '\\sigma' },
      { unicode: 'τ', latex: '\\tau' },
      { unicode: 'φ', latex: '\\phi' },
      { unicode: 'χ', latex: '\\chi' },
      { unicode: 'ψ', latex: '\\psi' },
      { unicode: 'ω', latex: '\\omega' },
      { unicode: 'Γ', latex: '\\Gamma' },
      { unicode: 'Δ', latex: '\\Delta' },
      { unicode: 'Θ', latex: '\\Theta' },
      { unicode: 'Λ', latex: '\\Lambda' },
      { unicode: 'Ξ', latex: '\\Xi' },
      { unicode: 'Π', latex: '\\Pi' },
      { unicode: 'Σ', latex: '\\Sigma' },
      { unicode: 'Φ', latex: '\\Phi' },
      { unicode: 'Ψ', latex: '\\Psi' },
      { unicode: 'Ω', latex: '\\Omega' },
    ],
  },
  {
    key: 'discrete',
    nameZh: '离散数学',
    nameEn: 'Discrete Math',
    items: [
      { unicode: '∀', latex: '\\forall' },
      { unicode: '∃', latex: '\\exists' },
      { unicode: '∄', latex: '\\nexists' },
      { unicode: '∈', latex: '\\in' },
      { unicode: '∉', latex: '\\notin' },
      { unicode: '∋', latex: '\\ni' },
      { unicode: '⊂', latex: '\\subset' },
      { unicode: '⊃', latex: '\\supset' },
      { unicode: '⊆', latex: '\\subseteq' },
      { unicode: '⊇', latex: '\\supseteq' },
      { unicode: '∪', latex: '\\cup' },
      { unicode: '∩', latex: '\\cap' },
      { unicode: '∅', latex: '\\emptyset' },
      { unicode: '∧', latex: '\\land' },
      { unicode: '∨', latex: '\\lor' },
      { unicode: '¬', latex: '\\neg' },
      { unicode: '⊕', latex: '\\oplus' },
      { unicode: '⊖', latex: '\\ominus' },
      { unicode: '⊢', latex: '\\vdash' },
      { unicode: '⊨', latex: '\\models' },
    ],
  },
  {
    key: 'calculus',
    nameZh: '高等数学',
    nameEn: 'Calculus',
    items: [
      { unicode: '∫', latex: '\\int' },
      { unicode: '∬', latex: '\\iint' },
      { unicode: '∭', latex: '\\iiint' },
      { unicode: '∮', latex: '\\oint' },
      { unicode: '∑', latex: '\\sum' },
      { unicode: '∏', latex: '\\prod' },
      { unicode: '∞', latex: '\\infty' },
      { unicode: '∂', latex: '\\partial' },
      { unicode: '∇', latex: '\\nabla' },
      { unicode: 'lim', latex: '\\lim' },
      { unicode: 'dx', latex: '\\mathrm{d}x' },
    ],
  },
  {
    key: 'linear_algebra',
    nameZh: '线性代数',
    nameEn: 'Linear Algebra',
    items: [
      { unicode: '×', latex: '\\times' },
      { unicode: '·', latex: '\\cdot' },
      { unicode: '⊗', latex: '\\otimes' },
      { unicode: '⊥', latex: '\\perp' },
      { unicode: 'det', latex: '\\det' },
      { unicode: '∥', latex: '\\parallel' },
      { unicode: '†', latex: '\\dagger' },
      { unicode: '‖·‖', latex: '\\|\\cdot\\|' },
      { unicode: '⟨,⟩', latex: '\\langle,\\rangle' },
    ],
  },
  {
    key: 'relations',
    nameZh: '关系运算',
    nameEn: 'Relations',
    items: [
      { unicode: '≤', latex: '\\leq' },
      { unicode: '≥', latex: '\\geq' },
      { unicode: '≠', latex: '\\neq' },
      { unicode: '≈', latex: '\\approx' },
      { unicode: '≡', latex: '\\equiv' },
      { unicode: '∼', latex: '\\sim' },
      { unicode: '≅', latex: '\\cong' },
      { unicode: '≪', latex: '\\ll' },
      { unicode: '≫', latex: '\\gg' },
      { unicode: '∝', latex: '\\propto' },
      { unicode: '±', latex: '\\pm' },
      { unicode: '∓', latex: '\\mp' },
      { unicode: '÷', latex: '\\div' },
    ],
  },
  {
    key: 'arrows',
    nameZh: '箭头',
    nameEn: 'Arrows',
    items: [
      { unicode: '→', latex: '\\to' },
      { unicode: '←', latex: '\\leftarrow' },
      { unicode: '↔', latex: '\\leftrightarrow' },
      { unicode: '⇒', latex: '\\Rightarrow' },
      { unicode: '⇐', latex: '\\Leftarrow' },
      { unicode: '⇔', latex: '\\Leftrightarrow' },
      { unicode: '↦', latex: '\\mapsto' },
      { unicode: '↑', latex: '\\uparrow' },
      { unicode: '↓', latex: '\\downarrow' },
      { unicode: '⇑', latex: '\\Uparrow' },
      { unicode: '⇓', latex: '\\Downarrow' },
      { unicode: '↗', latex: '\\nearrow' },
      { unicode: '↘', latex: '\\searrow' },
    ],
  },
  {
    key: 'structures',
    nameZh: '常用结构',
    nameEn: 'Structures',
    items: [
      { unicode: 'a/b', latex: '\\frac{a}{b}' },
      { unicode: '√x', latex: '\\sqrt{x}' },
      { unicode: 'ⁿ√x', latex: '\\sqrt[n]{x}' },
      { unicode: '∑ᵢ₌₁ⁿ', latex: '\\sum_{i=1}^{n}' },
      { unicode: '∫ₐᵇ', latex: '\\int_{a}^{b}' },
      { unicode: 'limₓ→₀', latex: '\\lim_{x \\to 0}' },
      { unicode: 'C(n,k)', latex: '\\binom{n}{k}' },
      { unicode: 'a⃗', latex: '\\vec{a}' },
      { unicode: 'x̂', latex: '\\hat{x}' },
      { unicode: 'ā', latex: '\\bar{a}' },
      { unicode: 'ȧ', latex: '\\dot{a}' },
      { unicode: 'xₙ', latex: 'x_{n}' },
      { unicode: 'xⁿ', latex: 'x^{n}' },
    ],
  },
]

/** Find a category by its key */
export function findMathCategory(key: string): MathCategory | undefined {
  return MATH_CATEGORIES.find((cat) => cat.key === key)
}
