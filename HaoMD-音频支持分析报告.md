# HaoMD 音频支持分析报告

**分析日期**: 2026-02-12

---

## 1. 音频支持概述

HaoMD 通过自定义协议和 Markdown 扩展语法支持音频文件的播放，主要实现位于 `MarkdownViewer.tsx` 组件中。

---

## 2. 核心实现机制

### 2.1 音频识别逻辑

**文件位置**: `app/src/components/MarkdownViewer.tsx` (第 326-337 行)

```typescript
const lowerAlt = cleanAlt.toLowerCase()
const isAudioByAlt = lowerAlt === 'audio' || lowerAlt === '音频'
const isAudioByExt = /\.(mp3|wav|m4a|ogg|flac)$/i.test(src)
const isAudio = isAudioByAlt || isAudioByExt

if (isAudio) {
  return (
    <audio controls src={finalSrc} style={{ width: '100%' }}>
      您的浏览器不支持 audio 标签。
    </audio>
  )
}
```

### 2.2 音频识别方式

项目支持两种方式识别音频：

#### 方式 1：通过 `alt` 属性识别

```markdown
![audio](path/to/audio.mp3)
![音频](path/to/audio.mp3)
```

- **触发条件**: `alt` 属性为 `"audio"` 或 `"音频"`（不区分大小写）
- **优先级**: 高于扩展名识别

#### 方式 2：通过文件扩展名识别

```markdown
![](path/to/music.mp3)
![任何文字](audio.wav)
```

- **支持的扩展名**:
  - `.mp3` - MPEG Audio Layer III
  - `.wav` - Waveform Audio File Format
  - `.m4a` - MPEG-4 Audio
  - `.ogg` - Ogg Vorbis
  - `.flac` - Free Lossless Audio Codec

---

## 3. 文件路径处理

### 3.1 相对路径转换

**实现位置**: `MarkdownViewer.tsx` (第 279-324 行)

```typescript
if (filePath && src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
  const fileDir = filePath.replace(/[/\\][^/\\]+$/, '')
  const sep = filePath.includes('\\') ? '\\' : '/'
  
  // 计算绝对路径
  let absPath = src
  if (src.startsWith('.')) {
    // 处理 ./ ../ 等相对路径
    const parts = src.split(/[\/\\]/)
    let dir = fileDir
    for (const part of parts) {
      if (part === '..') {
        dir = dir.replace(/[/\\][^/\\]+$/, '')
      } else if (part !== '.') {
        dir = dir + sep + part
      }
    }
    absPath = dir
  } else if (!src.match(/^[a-zA-Z]:/)) {
    // 不是绝对路径，拼接当前文件目录
    absPath = fileDir + sep + src
  }
  
  // 生成 haomd:// 协议 URL
  const pathParts = absPath.split(/([/\\])/)
  const encodedParts = pathParts.map((part: string) => {
    if (part === '/' || part === '\\') return part
    return encodeURIComponent(part)
  })
  const encoded = encodedParts.join('')
  const isWindows = filePath.includes('\\') || navigator.userAgent.includes('Windows')
  if (isWindows) {
    finalSrc = `https://haomd.localhost${encoded}`
  } else {
    finalSrc = `haomd://localhost${encoded}`
  }
}
```

### 3.2 路径处理示例

| 输入路径 | 当前文件路径 | 生成的协议 URL |
|---------|-------------|----------------|
| `./audio.mp3` | `/Users/test/doc.md` | `haomd://localhost/Users/test/audio.mp3` |
| `../music/song.mp3` | `/Users/test/docs/doc.md` | `haomd://localhost/Users/test/music/song.mp3` |
| `audio.mp3` | `/Users/test/doc.md` | `haomd://localhost/Users/test/audio.mp3` |
| `C:\Music\song.mp3` | `C:\Docs\readme.md` | `https://haomd.localhost/C:/Music/song.mp3` |

### 3.3 中文文件名支持

```typescript
const encodedParts = pathParts.map((part: string) => {
  if (part === '/' || part === '\\') return part
  return encodeURIComponent(part)  // ← 编码中文和特殊字符
})
```

**示例**:
- 输入: `/Users/test/音乐文件.mp3`
- 输出: `haomd://localhost/Users/test/%E9%9F%B3%E4%B9%90%E6%96%87%E4%BB%B6.mp3`

---

## 4. 自定义协议实现

### 4.1 协议注册

**文件位置**: `app/src-tauri/src/lib.rs` (第 1536-1609 行)

```rust
tauri::Builder::default()
  .register_uri_scheme_protocol("haomd", move |_context, _request| {
    let uri = _request.uri();
    let raw_path = uri.path();
    
    // URL 解码
    let mut decoded = raw_path.to_string();
    loop {
      let new_decoded = percent_decode_str(&decoded)
        .decode_utf8_lossy()
        .to_string();
      if new_decoded == decoded {
        break;
      }
      decoded = new_decoded;
    }
    
    let path = std::path::PathBuf::from(&decoded);
    
    // 读取文件
    match std::fs::read(&path) {
      Ok(data) => {
        let mime = mime_guess::from_path(&path)
          .first_or_octet_stream()
          .to_string();
        
        Response::builder()
          .status(200)
          .header("Content-Type", mime.as_str())
          .body(data)
          .unwrap()
      }
      Err(e) => {
        Response::builder()
          .status(404)
          .body(Vec::new())
          .unwrap()
      }
    }
  })
```

### 4.2 平台差异

| 平台 | 协议格式 | 示例 |
|------|---------|------|
| **macOS/Linux** | `haomd://localhost/...` | `haomd://localhost/Users/test/audio.mp3` |
| **Windows** | `https://haomd.localhost/...` | `https://haomd.localhost/C:/Users/test/audio.mp3` |

**原因**: Windows WebView2 对自定义协议的支持有限制，使用 `https://` 前缀更稳定。

### 4.3 MIME 类型自动识别

```rust
let mime = mime_guess::from_path(&path)
  .first_or_octet_stream()
  .to_string();
```

**常见音频 MIME 类型**:

| 扩展名 | MIME 类型 |
|--------|----------|
| `.mp3` | `audio/mpeg` |
| `.wav` | `audio/wav` |
| `.m4a` | `audio/mp4` |
| `.ogg` | `audio/ogg` |
| `.flac` | `audio/flac` |

---

## 5. 渲染流程

### 5.1 完整流程图

```
Markdown 文本
     ↓
ReactMarkdown 解析
     ↓
识别 img 标签
     ↓
检查 alt 属性或文件扩展名
     ↓
判断是否为音频
     ↓
├─ 是音频 → 渲染 <audio> 标签
│            ↓
│        转换路径为 haomd:// 协议
│            ↓
│        Tauri 协议处理器读取本地文件
│            ↓
│        返回音频数据流
│            ↓
│        浏览器播放音频
│
└─ 是图片 → 渲染 <img> 标签
```

### 5.2 代码执行路径

```typescript
// 1. ReactMarkdown 组件渲染
<ReactMarkdown
  components={{
    img: ({ node, ...props }) => {
      // 2. 提取 src 和 alt
      const src = props.src || ''
      const altText = props.alt || ''
      
      // 3. 判断是否为音频
      const isAudio = /* 判断逻辑 */
      
      // 4. 处理路径
      let finalSrc = src
      if (isRelativePath(src)) {
        finalSrc = convertToHaomdProtocol(src, filePath)
      }
      
      // 5. 渲染对应标签
      if (isAudio) {
        return <audio controls src={finalSrc} />
      } else {
        return <img src={finalSrc} />
      }
    }
  }}
/>
```

---

## 6. 使用示例

### 6.1 基本用法

```markdown
# 音乐列表

## 流行音乐
![audio](./music/pop.mp3)

## 古典音乐
![音频](./music/classical.wav)

## 直接引用（通过扩展名识别）
![](./audio/jazz.m4a)
```

### 6.2 相对路径引用

```markdown
# 文档目录结构
docs/
  ├── readme.md
  └── audio/
      ├── intro.mp3
      └── chapter1/
          └── demo.wav

# readme.md 内容
![audio](./audio/intro.mp3)
![音频](./audio/chapter1/demo.wav)
```

### 6.3 绝对路径引用

```markdown
<!-- macOS/Linux -->
![audio](/Users/username/Music/song.mp3)

<!-- Windows -->
![音频](C:/Users/username/Music/song.mp3)
```

### 6.4 网络音频

```markdown
<!-- 网络音频不需要协议转换 -->
![audio](https://example.com/audio.mp3)
```

---

## 7. 技术细节

### 7.1 HTML5 Audio API

项目使用浏览器原生 `<audio>` 标签，支持以下功能：

```typescript
<audio 
  controls           // 显示播放控件
  src={finalSrc}     // 音频源 URL
  style={{ width: '100%' }}  // 响应式宽度
>
  您的浏览器不支持 audio 标签。
</audio>
```

**支持的操作**:
- ✅ 播放/暂停
- ✅ 进度控制
- ✅ 音量调节
- ✅ 倍速播放（浏览器原生支持）
- ✅ 循环播放
- ✅ 下载（浏览器右键菜单）

### 7.2 路径编码策略

```typescript
const pathParts = absPath.split(/([/\\])/)
const encodedParts = pathParts.map((part: string) => {
  if (part === '/' || part === '\\') return part  // 保留分隔符
  return encodeURIComponent(part)  // 编码其他部分
})
```

**编码示例**:

| 原始路径 | 编码后 |
|---------|--------|
| `/Users/test/音乐.mp3` | `/Users/test/%E9%9F%B3%E4%B9%90.mp3` |
| `/Users/test/audio file.mp3` | `/Users/test/audio%20file.mp3` |
| `/Users/test/测试音频(1).mp3` | `/Users/test/%E6%B5%8B%E8%AF%95%E9%9F%B3%E9%A2%91(1).mp3` |

### 7.3 协议处理器错误处理

```rust
match std::fs::read(&path) {
  Ok(data) => {
    // 成功读取文件，返回 200 + 数据
  }
  Err(e) => {
    log::error!("[tauri] haomd protocol: failed to read file {:?}: {}", path, e);
    Response::builder()
      .status(404)
      .body(Vec::new())
      .unwrap()
  }
}
```

---

## 8. 限制与注意事项

### 8.1 当前限制

| 限制项 | 说明 | 影响 |
|--------|------|------|
| **无播放列表** | 每个音频独立播放 | 无法连续播放多个音频 |
| **无可视化** | 仅显示浏览器默认控件 | 无法显示波形图或频谱 |
| **无记忆功能** | 刷新页面后进度丢失 | 长音频用户体验不佳 |
| **无播放状态同步** | 多个音频可能同时播放 | 可能造成音频混乱 |

### 8.2 性能考虑

#### 文件大小建议

| 文件大小 | 加载方式 | 建议 |
|---------|---------|------|
| < 5 MB | 直接加载 | ✅ 推荐短音频 |
| 5-20 MB | 可接受加载时间 | ⚠️ 中等长度音频 |
| > 20 MB | 加载较慢 | ❌ 建议压缩或分割 |

#### 优化建议

1. **使用压缩格式**: MP3 > WAV
2. **控制比特率**: 128-192 kbps 足够
3. **分割长音频**: 按章节或段落分割

### 8.3 浏览器兼容性

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| **MP3** | ✅ | ✅ | ✅ | ✅ |
| **WAV** | ✅ | ✅ | ✅ | ✅ |
| **M4A** | ✅ | ✅ | ✅ | ✅ |
| **OGG** | ✅ | ✅ | ❌ | ✅ |
| **FLAC** | ✅ | ✅ | ✅ | ✅ |

---

## 9. 改进建议

### 9.1 功能增强

#### 建议 1：添加播放列表支持

```typescript
// 检测连续的音频标签
const audioList = messages.filter(msg => msg.type === 'audio')

if (audioList.length > 1) {
  return (
    <div className="audio-playlist">
      {audioList.map((audio, index) => (
        <div key={index} className="audio-item">
          <span>{audio.title}</span>
          <audio controls src={audio.src} />
        </div>
      ))}
    </div>
  )
}
```

#### 建议 2：添加播放进度记忆

```typescript
// 保存播放进度到 localStorage
const handleTimeUpdate = (audioId: string, currentTime: number) => {
  localStorage.setItem(`audio_progress_${audioId}`, String(currentTime))
}

// 恢复播放进度
const savedProgress = localStorage.getItem(`audio_progress_${audioId}`)
if (savedProgress) {
  audioRef.current.currentTime = parseFloat(savedProgress)
}
```

#### 建议 3：添加音频可视化

```typescript
// 使用 Web Audio API 绘制波形
const canvasRef = useRef<HTMLCanvasElement>(null)

useEffect(() => {
  const audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  const source = audioContext.createMediaElementSource(audioRef.current)
  
  source.connect(analyser)
  analyser.connect(audioContext.destination)
  
  // 绘制波形
  const draw = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    
    analyser.getByteTimeDomainData(dataArray)
    // ... 绘制逻辑
  }
}, [])
```

#### 建议 4：添加音频下载按钮

```typescript
<audio controls src={finalSrc} style={{ width: '100%' }}>
  您的浏览器不支持 audio 标签。
</audio>
<a href={finalSrc} download className="audio-download-btn">
  下载音频
</a>
```

### 9.2 UI 改进

#### 建议 1：自定义播放控件

```typescript
<div className="audio-player">
  <button onClick={togglePlay}>
    {isPlaying ? '⏸' : '▶'}
  </button>
  <progress value={currentTime} max={duration} />
  <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
  <input type="range" min="0" max="1" step="0.1" value={volume} onChange={setVolume} />
</div>
```

#### 建议 2：添加音频信息显示

```typescript
<div className="audio-info">
  <div className="audio-title">{title}</div>
  <div className="audio-meta">
    <span>时长: {duration}</span>
    <span>格式: {format}</span>
    <span>大小: {fileSize}</span>
  </div>
</div>
```

---

## 10. 测试用例

### 10.1 功能测试

| 测试项 | 输入 | 预期结果 |
|--------|------|---------|
| **alt 识别** | `![audio](test.mp3)` | 渲染 audio 标签 |
| **中文 alt** | `![音频](test.mp3)` | 渲染 audio 标签 |
| **扩展名识别** | `![](test.wav)` | 渲染 audio 标签 |
| **相对路径** | `![audio](./audio/test.mp3)` | 正确加载本地文件 |
| **绝对路径** | `![audio](/Users/test/audio.mp3)` | 正确加载本地文件 |
| **网络路径** | `![audio](https://example.com/audio.mp3)` | 直接加载网络音频 |
| **中文文件名** | `![audio](./音乐文件.mp3)` | 正确编码并加载 |
| **特殊字符** | `![audio](./audio file.mp3)` | 正确编码空格 |
| **不支持的格式** | `![audio](./test.xyz)` | 渲染 audio 标签（可能无法播放）|

### 10.2 边界测试

| 测试项 | 场景 | 预期结果 |
|--------|------|---------|
| **空路径** | `![audio]()` | 不渲染或显示错误 |
| **文件不存在** | `![audio](./nonexistent.mp3)` | audio 标签加载失败 |
| **权限错误** | 访问受限目录 | 返回 404 错误 |
| **超大文件** | > 50MB 音频 | 加载缓慢但可播放 |
| **路径注入** | `![audio](../../etc/passwd)` | 协议限制在本地文件系统 |

---

## 11. 总结

### 11.1 优势

- ✅ **简单易用**: 标准 Markdown 语法
- ✅ **多格式支持**: 5 种常见音频格式
- ✅ **跨平台**: macOS/Windows/Linux 统一实现
- ✅ **中文友好**: 支持中文文件名和路径
- ✅ **性能优秀**: 本地文件直接读取，无需上传

### 11.2 不足

- ⚠️ **功能基础**: 无播放列表、记忆等高级功能
- ⚠️ **UI 默认**: 使用浏览器原生控件
- ⚠️ **无可视化**: 无波形图或频谱显示

### 11.3 总体评价

HaoMD 的音频支持实现简洁有效，通过自定义协议解决了本地文件访问问题，支持多种音频格式和中文文件名。适合基本的音频播放需求，但对于高级音频功能（如播放列表、可视化）需要进一步扩展。

---

**文档版本**: v1.0  
**最后更新**: 2026-02-12  
**维护者**: HaoMD 开发团队
