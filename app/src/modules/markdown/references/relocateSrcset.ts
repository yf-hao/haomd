/** Follow srcset's URL/descriptor boundaries; commas inside data URLs are data. */
export function relocateSrcset(value: string, rewrite: (url: string) => string): string {
  let index = 0
  let copied = 0
  let output = ''
  while (index < value.length) {
    while (index < value.length && /[\t\n\f\r ,]/.test(value[index])) index++
    const start = index
    while (index < value.length && !/[\t\n\f\r ]/.test(value[index])) index++
    let end = index
    while (end > start && value[end - 1] === ',') end--
    if (end === start) continue
    output += value.slice(copied, start) + rewrite(value.slice(start, end))
    copied = end
    if (end < index) continue
    // Descriptor parentheses can contain commas; only an outer comma ends it.
    let parentheses = 0
    while (index < value.length) {
      const char = value[index++]
      if (char === '(') parentheses++
      else if (char === ')') parentheses = Math.max(0, parentheses - 1)
      else if (char === ',' && parentheses === 0) break
    }
  }
  return output + value.slice(copied)
}
