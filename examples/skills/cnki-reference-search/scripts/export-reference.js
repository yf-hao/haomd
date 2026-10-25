function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, function (_, code) { return String.fromCodePoint(parseInt(code, 16)) })
    .replace(/&#([0-9]+);?/g, function (_, code) { return String.fromCodePoint(parseInt(code, 10)) })
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function cleanCitation(value) {
  const plain = decodeHtml(value.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  return plain
    .replace(/\.?https?:\/\/\S+/g, '')
    .replace(/DOI:\S+/g, '')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\.\s*/g, '.')
    .replace(/(\d+)-(\d+)\[(\d{4})-(\d{2})-(\d{2})\]/g, '$3,$1-$2')
    .trim()
}

function run(args) {
  const cookie = typeof args?.cookie === 'string' ? args.cookie : ''
  const filename = typeof args?.filename === 'string' ? args.filename.trim().replace(/!+$/, '') : ''
  if (!cookie.trim()) {
    return { ok: false, stdout: '', stderr: 'CNKI Cookie is missing. Add the current Cookie header value to this Skill\'s cookie.txt file.', exitCode: 1 }
  }
  if (cookie.length > 8192 || /[\r\n]/.test(cookie)) {
    return { ok: false, stdout: '', stderr: 'cookie must be 8 KiB or fewer and contain no line breaks', exitCode: 1 }
  }
  if (!filename || filename.length > 1200) {
    return { ok: false, stdout: '', stderr: 'Missing or invalid arg: filename', exitCode: 1 }
  }

  const response = http.request({
    url: 'https://kns.cnki.net/dm8/API/GetExport',
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookie,
      Referer: 'https://kns.cnki.net/kns8s/defaultresult/index',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
    form: { filename, displaymode: 'GBTREFER,MLA,APA', uniplatform: 'NZKPT' },
  })

  if (/\/verify\//i.test(response.headers?.location || '') || /\/verify\/|滑块验证|验证码|安全验证/.test(response.body || '')) {
    return {
      ok: false,
      stdout: JSON.stringify({ stage: 'export', status: response.status, location: response.headers?.location, cookies: response.cookies }),
      stderr: 'CNKI returned a verification response while exporting the citation. The supplied Cookie may be expired or require verification.',
      exitCode: 2,
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      stdout: JSON.stringify({ stage: 'export', status: response.status, cookies: response.cookies }),
      stderr: 'CNKI citation export request failed.',
      exitCode: 1,
    }
  }

  let payload
  try {
    payload = JSON.parse(response.body)
  } catch (_) {
    return { ok: false, stdout: JSON.stringify({ stage: 'export', status: response.status }), stderr: 'CNKI citation response was not valid JSON.', exitCode: 1 }
  }
  const mode = Array.isArray(payload.data) ? payload.data.find((item) => item.mode === 'GBTREFER') : null
  const value = Array.isArray(mode?.value) ? mode.value[0] : mode?.value
  const citation = typeof value === 'string' ? cleanCitation(value) : ''
  if (payload.code !== 1 || !citation) {
    return {
      ok: false,
      stdout: JSON.stringify({ stage: 'export', code: payload.code, message: payload.msg, cookies: response.cookies }),
      stderr: 'CNKI did not return a GB/T 7714 citation for this record.',
      exitCode: 1,
    }
  }

  return {
    ok: true,
    stdout: JSON.stringify({ citation, cookies: response.cookies }, null, 2),
    stderr: '',
    exitCode: 0,
  }
}
