function attribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp('(?:^|\\s)' + escapedName + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'))
  return match ? (match[1] || match[2] || match[3] || '') : ''
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, function (_, code) {
      return String.fromCodePoint(parseInt(code, 16))
    })
    .replace(/&#([0-9]+);?/g, function (_, code) {
      return String.fromCodePoint(parseInt(code, 10))
    })
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function cleanText(html) {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function attributeLoose(tag, name) {
  const matcher = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  const target = name.toLowerCase()
  let match
  while ((match = matcher.exec(tag))) {
    if (match[1].toLowerCase() === target) return match[2] || match[3] || match[4] || ''
  }
  return ''
}

function isVerificationResponse(response) {
  const location = response.headers?.location || ''
  return /\/verify\//i.test(location) || /\/verify\//i.test(response.body || '') ||
    /滑块验证|验证码|安全验证/.test(response.body || '')
}

function readRows(html) {
  const tableMatch = html.match(/<table\b[^>]*class\s*=\s*["'][^"']*result-table-list[^"']*["'][^>]*>([\s\S]*?)<\/table\s*>/i)
  const tableHtml = tableMatch ? tableMatch[1] : html
  const rowMatches = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) || []
  const records = []

  for (const rowHtml of rowMatches) {
    if (!/<td\b/i.test(rowHtml)) continue
    const cells = []
    const cellMatches = rowHtml.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]\s*>/gi) || []
    for (const cell of cellMatches) cells.push(cleanText(cell))
    if (!cells.length) continue

    let titleText = ''
    let titleHref = ''
    let filename = ''
    const dataCells = rowHtml.match(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi) || []
    for (const cell of dataCells) {
      const openingTag = cell.slice(0, cell.indexOf('>') + 1)
      const classNames = attributeLoose(openingTag, 'class').split(/\s+/)
      if (classNames.includes('seq')) {
        const checkbox = (cell.match(/<input\b[^>]*>/gi) || []).find((input) =>
          attributeLoose(input, 'type').toLowerCase() === 'checkbox' &&
          attributeLoose(input, 'name') === 'CookieName',
        )
        if (checkbox) filename = decodeHtml(attributeLoose(checkbox, 'value')).replace(/!+$/, '')
      } else if (classNames.includes('name')) {
        const titleAnchor = (cell.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) || []).find((anchor) =>
          attributeLoose(anchor.slice(0, anchor.indexOf('>') + 1), 'class').split(/\s+/).includes('fz14'),
        )
        if (titleAnchor) {
          const anchorTag = titleAnchor.slice(0, titleAnchor.indexOf('>') + 1)
          titleText = cleanText(titleAnchor)
          titleHref = decodeHtml(attributeLoose(anchorTag, 'href'))
        }
      }
    }

    const links = []
    const linkMatches = rowHtml.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) || []
    for (const link of linkMatches) {
      const href = decodeHtml(attribute(link.slice(0, link.indexOf('>') + 1), 'href'))
      const text = cleanText(link)
      if (href && text) links.push({ text, href })
    }

    const inputs = []
    const inputMatches = rowHtml.match(/<input\b[^>]*>/gi) || []
    for (const input of inputMatches) {
      inputs.push({
        name: decodeHtml(attributeLoose(input, 'name')),
        value: decodeHtml(attributeLoose(input, 'value')),
        type: attributeLoose(input, 'type'),
      })
    }

    const titleLink = titleHref ? links.find((link) => link.href === titleHref) : undefined
    const fallbackTitle = (cells[1] || '').replace(/\s*免费\s*-->\s*$/, '').trim()
    records.push({
      cells,
      title: titleText || fallbackTitle,
      authors: cells[2] || '',
      source: cells[3] || '',
      date: cells[4] || '',
      link: (titleHref || titleLink?.href)
        ? (/^https?:\/\//i.test(titleHref || titleLink.href) ? (titleHref || titleLink.href) : 'https://kns.cnki.net' + (titleHref || titleLink.href))
        : '',
      filename,
    })
  }

  return records
}

function run(args) {
  const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : ''
  const cookie = typeof args?.cookie === 'string' ? args.cookie : ''
  const page = Number.isInteger(args?.page) && args.page > 0 ? args.page : 1
  if (!keyword) {
    return { ok: false, stdout: '', stderr: 'Missing required arg: keyword', exitCode: 1 }
  }
  if (keyword.length > 200) {
    return { ok: false, stdout: '', stderr: 'keyword must be 200 characters or fewer', exitCode: 1 }
  }
  if (!cookie.trim()) {
    return { ok: false, stdout: '', stderr: 'CNKI Cookie is missing. Add the current Cookie header value to this Skill\'s cookie.txt file.', exitCode: 1 }
  }
  if (cookie.length > 8192 || /[\r\n]/.test(cookie)) {
    return { ok: false, stdout: '', stderr: 'cookie must be 8 KiB or fewer and contain no line breaks', exitCode: 1 }
  }

  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
  const referer = 'https://kns.cnki.net/kns8s/defaultresult/index?crossids=YSTT4HG0%2CLSTPFY1C%2CEMRPGLPA%2CJUP3MUPD%2CMPMFIG1A%2CWQ0UVIAA%2CBLZOG7CK%2CPWFIRAGL%2CNLBO1Z6R%2CNN3FJMUV&korder=SU&kw=' + encodeURIComponent(keyword)

  const query = {
    Platform: '',
    Resource: 'CROSSDB',
    Classid: 'WD0FTY92',
    Products: '',
    QNode: {
      QGroup: [
        {
          Key: 'Subject',
          Title: '',
          Logic: 0,
          Items: [{
            Field: 'SU',
            Value: keyword,
            Operator: 'TOPRANK',
            Logic: 0,
            Vector: '',
            Title: '主题',
          }],
          ChildItems: [],
        },
        { Key: 'ControlGroup', Title: '', Logic: 0, Items: [], ChildItems: [] },
      ],
    },
    ExScope: 1,
    SimpTrad: '0',
    SearchType: 2,
    Rlang: 'CHINESE',
    KuaKuCode: 'YSTT4HG0,LSTPFY1C,EMRPGLPA,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,NLBO1Z6R,NN3FJMUV',
    Expands: {},
    View: 'changeDBCh',
    SearchFrom: 1,
  }

  const search = http.request({
    url: 'https://kns.cnki.net/kns8s/brief/grid',
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ckb;q=0.6,zh-TW;q=0.5',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookie,
      Origin: 'https://kns.cnki.net',
      Pragma: 'no-cache',
      Referer: referer,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'sec-ch-ua': '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
    form: {
      boolSearch: 'true',
      QueryJson: JSON.stringify(query),
      pageNum: String(page),
      pageSize: '20',
      sortField: '',
      sortType: '',
      dstyle: 'listmode',
      productStr: '',
      aside: '(主题：' + keyword + ')',
      searchFrom: '资源范围：总库',
      subject: '',
      language: '',
      uniplatform: '',
      CurPage: '1',
    },
  })

  if (isVerificationResponse(search)) {
    return {
      ok: false,
      stdout: JSON.stringify({ stage: 'search', keyword, status: search.status, location: search.headers?.location, cookies: search.cookies }),
      stderr: 'CNKI returned a verification page for the search request. Cookie receipt does not mean verification passed.',
      exitCode: 2,
    }
  }
  if (!search.ok) {
    return {
      ok: false,
      stdout: JSON.stringify({ stage: 'search', keyword, status: search.status, cookies: search.cookies }),
      stderr: 'CNKI search request failed.',
      exitCode: 1,
    }
  }

  const records = readRows(search.body)
  return {
    ok: true,
    stdout: JSON.stringify({
      keyword,
      page,
      count: records.length,
      cookies: search.cookies,
      records,
    }, null, 2),
    stderr: '',
    exitCode: 0,
  }
}
