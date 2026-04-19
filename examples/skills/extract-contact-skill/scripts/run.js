function run(args) {
  const text = typeof args?.text === 'string' ? args.text.trim() : ''

  if (!text) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Missing required arg: text',
      exitCode: 1,
    }
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = text.match(/1\d{10}/)
  const nameMatch = text.match(/^[\u4e00-\u9fffA-Za-z·\s]{2,20}/)

  const result = {
    name: nameMatch ? nameMatch[0].trim() : '',
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneMatch ? phoneMatch[0] : '',
  }

  return {
    ok: true,
    stdout: JSON.stringify(result, null, 2),
    stderr: '',
    exitCode: 0,
  }
}
