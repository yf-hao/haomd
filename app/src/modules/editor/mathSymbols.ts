/**
 * Math symbol definitions for the Format > Math Symbols dialog.
 * Each item has a LaTeX command rendered via KaTeX in the dialog.
 */

export interface MathSymbolItem {
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
      { latex: '\\alpha' },
      { latex: '\\beta' },
      { latex: '\\gamma' },
      { latex: '\\delta' },
      { latex: '\\epsilon' },
      { latex: '\\zeta' },
      { latex: '\\eta' },
      { latex: '\\theta' },
      { latex: '\\iota' },
      { latex: '\\kappa' },
      { latex: '\\lambda' },
      { latex: '\\mu' },
      { latex: '\\nu' },
      { latex: '\\xi' },
      { latex: '\\pi' },
      { latex: '\\rho' },
      { latex: '\\sigma' },
      { latex: '\\tau' },
      { latex: '\\phi' },
      { latex: '\\chi' },
      { latex: '\\psi' },
      { latex: '\\omega' },
      { latex: '\\Gamma' },
      { latex: '\\Delta' },
      { latex: '\\Theta' },
      { latex: '\\Lambda' },
      { latex: '\\Xi' },
      { latex: '\\Pi' },
      { latex: '\\Sigma' },
      { latex: '\\Phi' },
      { latex: '\\Psi' },
      { latex: '\\Omega' },
    ],
  },
  {
    key: 'discrete',
    nameZh: '离散数学',
    nameEn: 'Discrete Math',
    items: [
      { latex: '\\forall' },
      { latex: '\\exists' },
      { latex: '\\nexists' },
      { latex: '\\in' },
      { latex: '\\notin' },
      { latex: '\\ni' },
      { latex: '\\subset' },
      { latex: '\\supset' },
      { latex: '\\subseteq' },
      { latex: '\\supseteq' },
      { latex: '\\cup' },
      { latex: '\\cap' },
      { latex: '\\emptyset' },
      { latex: '\\land' },
      { latex: '\\lor' },
      { latex: '\\neg' },
      { latex: '\\oplus' },
      { latex: '\\ominus' },
      { latex: '\\vdash' },
      { latex: '\\models' },
    ],
  },
  {
    key: 'calculus',
    nameZh: '高等数学',
    nameEn: 'Calculus',
    items: [
      { latex: '\\int' },
      { latex: '\\iint' },
      { latex: '\\iiint' },
      { latex: '\\oint' },
      { latex: '\\sum' },
      { latex: '\\prod' },
      { latex: '\\infty' },
      { latex: '\\partial' },
      { latex: '\\nabla' },
      { latex: '\\lim' },
      { latex: '\\mathrm{d}x' },
    ],
  },
  {
    key: 'linear_algebra',
    nameZh: '线性代数',
    nameEn: 'Linear Algebra',
    items: [
      { latex: '\\times' },
      { latex: '\\cdot' },
      { latex: '\\otimes' },
      { latex: '\\perp' },
      { latex: '\\det' },
      { latex: '\\parallel' },
      { latex: '\\dagger' },
      { latex: '\\|\\cdot\\|' },
      { latex: '\\langle,\\rangle' },
    ],
  },
  {
    key: 'relations',
    nameZh: '关系运算',
    nameEn: 'Relations',
    items: [
      { latex: '\\leq' },
      { latex: '\\geq' },
      { latex: '\\neq' },
      { latex: '\\approx' },
      { latex: '\\equiv' },
      { latex: '\\sim' },
      { latex: '\\cong' },
      { latex: '\\ll' },
      { latex: '\\gg' },
      { latex: '\\propto' },
      { latex: '\\pm' },
      { latex: '\\mp' },
      { latex: '\\div' },
    ],
  },
  {
    key: 'arrows',
    nameZh: '箭头',
    nameEn: 'Arrows',
    items: [
      { latex: '\\to' },
      { latex: '\\leftarrow' },
      { latex: '\\leftrightarrow' },
      { latex: '\\Rightarrow' },
      { latex: '\\Leftarrow' },
      { latex: '\\Leftrightarrow' },
      { latex: '\\mapsto' },
      { latex: '\\uparrow' },
      { latex: '\\downarrow' },
      { latex: '\\Uparrow' },
      { latex: '\\Downarrow' },
      { latex: '\\nearrow' },
      { latex: '\\searrow' },
    ],
  },
  {
    key: 'structures',
    nameZh: '常用结构',
    nameEn: 'Structures',
    items: [
      { latex: '\\frac{a}{b}' },
      { latex: '\\sqrt{x}' },
      { latex: '\\sqrt[n]{x}' },
      { latex: '\\sum_{i=1}^{n}' },
      { latex: '\\int_{a}^{b}' },
      { latex: '\\lim_{x \\to 0}' },
      { latex: '\\binom{n}{k}' },
      { latex: '\\vec{a}' },
      { latex: '\\hat{x}' },
      { latex: '\\bar{a}' },
      { latex: '\\dot{a}' },
      { latex: 'x_{n}' },
      { latex: 'x^{n}' },
    ],
  },
  {
    key: 'annotation',
    nameZh: '标注',
    nameEn: 'Annotation',
    items: [
      { latex: '\\overbrace{a+b+c}^{\\text{note}}' },
      { latex: '\\underbrace{a+b+c}_{\\text{note}}' },
      { latex: '\\cancel{5}' },
      { latex: '\\bcancel{5}' },
      { latex: '\\xcancel{ABC}' },
      { latex: '\\not =' },
      { latex: '\\sout{abc}' },
      { latex: '\\boxed{\\pi=\\frac{c}{d}}' },
      { latex: 'a_{\\angle n}' },
    ],
  },
]

/** Find a category by its key */
export function findMathCategory(key: string): MathCategory | undefined {
  return MATH_CATEGORIES.find((cat) => cat.key === key)
}
