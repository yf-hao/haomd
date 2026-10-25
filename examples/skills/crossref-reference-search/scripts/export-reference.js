function cleanText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (original, entity) {
      if (entity[0] !== '#') return entities[entity.toLowerCase()]
      const hex = entity[1].toLowerCase() === 'x'
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original
    }).replace(/\s+/g, ' ').trim()
}

function field(value) {
  return cleanText(Array.isArray(value) ? value[0] : value)
}

function normalizeDoi(value) {
  return cleanText(value).replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '').toLowerCase()
}

function yearOf(work) {
  for (const key of ['issued', 'published-print', 'published-online', 'published']) {
    const year = work[key]?.['date-parts']?.[0]?.[0]
    if (Number.isInteger(year) && year > 0) return year
  }
  return null
}

function authorName(author) {
  if (author.name) return cleanText(author.name)
  const family = cleanText(author.family)
  const given = cleanText(author.given)
  if (!family) return ''
  if (/[\u3400-\u9fff]/.test(family + given)) return family + given
  const initials = given.split(/[\s.\-]+/).filter(Boolean).map((name) => [...name][0].toUpperCase()).join(' ')
  return family.toUpperCase() + (initials ? ' ' + initials : '')
}

function formatCitation(work, index) {
  const title = field(work.title).replace(/[.。]+$/, '')
  const source = field(work['container-title']).replace(/[.。]+$/, '')
  const year = yearOf(work)
  const authors = Array.isArray(work.author) ? work.author : []
  const names = authors.slice(0, 3).map(authorName)
  if (!title || !source || !year || !names.length || names.some((name) => !name)) {
    throw new Error('The record lacks a title, publication source, year, or identifiable authors.')
  }
  if (!['journal-article', 'proceedings-article'].includes(work.type)) {
    throw new Error('Only journal and proceedings articles can be exported by this Skill.')
  }
  let authorText = names.join(', ')
  if (authors.length > 3) authorText += names.every((name) => /[\u3400-\u9fff]/.test(name)) ? ', 等' : ', et al.'
  const page = field(work.page) || field(work['article-number'])
  let publication
  if (work.type === 'journal-article') {
    const volume = field(work.volume)
    const issue = field(work.issue)
    publication = source + ', ' + year + (volume ? ', ' + volume : '') + (issue ? '(' + issue + ')' : '')
  } else {
    const location = field(work['publisher-location'])
    const publisher = field(work.publisher)
    publication = source + (publisher ? '. ' + (location ? location + ': ' : '') + publisher : '') + ', ' + year
  }
  const prefix = '[' + index + '] ' + authorText + (authorText.endsWith('.') ? ' ' : '. ') + title
  const citation = prefix + (work.type === 'journal-article' ? '[J]. ' : '[C]//') + publication + (page ? ': ' + page : '') + '.'
  return { citation, title, authors: names, year, type: work.type }
}

function run(args) {
  const fail = (message) => ({ ok: false, stdout: '', stderr: message, exitCode: 1 })
  const doi = typeof args?.doi === 'string' ? normalizeDoi(args.doi) : ''
  const index = args?.index === undefined ? 1 : args.index
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 512) return fail('A valid Crossref DOI is required.')
  if (!Number.isInteger(index) || index < 1 || index > 100) return fail('index must be an integer from 1 to 100.')
  let response
  try {
    response = http.request({
      url: 'https://api.crossref.org/works/' + encodeURIComponent(doi),
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'HaoMD-Crossref-Skill/1.0' },
    })
  } catch (error) {
    const detail = typeof error?.message === 'string' ? error.message : String(error)
    return fail('Crossref DOI verification request failed: ' + detail)
  }
  if (!response.ok || response.truncated) {
    return { ok: false, stdout: JSON.stringify({ doi, status: response.status }), stderr: response.truncated ? 'Crossref response was truncated.' : 'Crossref DOI verification failed.', exitCode: 1 }
  }
  let payload
  try {
    payload = JSON.parse(response.body)
  } catch (_) {
    return fail('Crossref returned invalid JSON.')
  }
  if (payload?.status !== 'ok' || !payload.message || normalizeDoi(payload.message.DOI) !== doi) {
    return fail('Crossref did not return metadata for the requested DOI.')
  }
  try {
    const reference = formatCitation(payload.message, index)
    return { ok: true, stdout: JSON.stringify({ source: 'external_crossref_metadata', doi, ...reference }), stderr: '', exitCode: 0 }
  } catch (error) {
    return fail(error.message)
  }
}
