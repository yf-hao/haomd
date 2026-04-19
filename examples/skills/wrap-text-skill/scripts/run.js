function run(args) {
  const text = typeof args?.text === 'string' ? args.text : ''
  const prefix = typeof args?.prefix === 'string' ? args.prefix : undefined
  const suffix = typeof args?.suffix === 'string' ? args.suffix : undefined

  if (!text) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Missing required arg: text',
      exitCode: 1,
    }
  }

  if (typeof prefix !== 'string') {
    return {
      ok: false,
      stdout: '',
      stderr: 'Missing required arg: prefix',
      exitCode: 1,
    }
  }

  if (typeof suffix !== 'string') {
    return {
      ok: false,
      stdout: '',
      stderr: 'Missing required arg: suffix',
      exitCode: 1,
    }
  }

  return {
    ok: true,
    stdout: `${prefix}${text}${suffix}`,
    stderr: '',
    exitCode: 0,
  }
}
