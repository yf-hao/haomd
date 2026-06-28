use crate::music_paths::music_root_dir;
use crate::music_sound::ensure_music_sound_available;
use crate::shared_audio::ensure_output_stream_handle;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use once_cell::sync::Lazy;
use rodio::{Decoder, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{
    mpsc::{self, RecvTimeoutError, Sender},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackState {
    pub playlist_id: Option<String>,
    pub file_name: Option<String>,
    pub playing: bool,
    pub paused: bool,
    pub paused_by_alarm: bool,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub volume: f32,
}

enum AudioCommand {
    Play {
        playlist_id: String,
        sound_path: String,
        file_name: String,
    },
    Pause,
    PauseByAlarm,
    Resume,
    Seek {
        position_ms: u64,
    },
    SetVolume {
        volume: f32,
    },
    Stop,
    Restore {
        playlist_id: String,
        sound_path: String,
        file_name: String,
        position_ms: u64,
        volume: f32,
        should_play: bool,
        paused_by_alarm: bool,
    },
    QueryState {
        respond_to: oneshot::Sender<MusicTrackState>,
    },
}

struct PlaybackState {
    file_name: Option<String>,
    playlist_id: Option<String>,
    sound_path: Option<String>,
    duration: Option<Duration>,
    position: Duration,
    started_at: Option<Instant>,
    playing: bool,
    paused: bool,
    paused_by_alarm: bool,
    volume: f32,
}

struct AudioRuntime {
    sink: Option<Sink>,
}

impl PlaybackState {
    fn new() -> Self {
        Self::new_with_volume(1.0)
    }

    fn new_with_volume(volume: f32) -> Self {
        Self {
            file_name: None,
            playlist_id: None,
            sound_path: None,
            duration: None,
            position: Duration::ZERO,
            started_at: None,
            playing: false,
            paused: false,
            paused_by_alarm: false,
            volume: clamp_volume(volume),
        }
    }

    fn current_position(&self) -> Duration {
        if self.playing && !self.paused {
            if let Some(started_at) = self.started_at {
                return self.position.saturating_add(started_at.elapsed());
            }
        }
        self.position
    }

    fn snapshot(&self) -> MusicTrackState {
        MusicTrackState {
            file_name: self.file_name.clone(),
            playlist_id: self.playlist_id.clone(),
            playing: self.playing,
            paused: self.paused,
            paused_by_alarm: self.paused_by_alarm,
            position_ms: duration_to_millis(self.current_position()),
            duration_ms: self.duration.map(duration_to_millis),
            volume: self.volume,
        }
    }
}

static AUDIO_WORKER: Lazy<Mutex<Option<Sender<AudioCommand>>>> = Lazy::new(|| Mutex::new(None));
static PLAYBACK_STATE: Lazy<Mutex<MusicTrackState>> =
    Lazy::new(|| Mutex::new(MusicTrackState::default()));
static MUSIC_SESSION_FILE: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MusicPlayerSession {
    state: MusicTrackState,
    updated_at: String,
}

fn duration_to_millis(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn millis_to_duration(position_ms: u64) -> Duration {
    Duration::from_millis(position_ms)
}

fn clamp_volume(volume: f32) -> f32 {
    volume.clamp(0.0, 1.0)
}

fn music_session_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    Ok(music_root_dir(app)?.join("player_state.json"))
}

fn set_music_session_file(path: PathBuf) {
    if let Ok(mut guard) = MUSIC_SESSION_FILE.lock() {
        *guard = Some(path);
    }
}

fn get_music_session_file() -> Option<PathBuf> {
    MUSIC_SESSION_FILE
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn store_music_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = music_session_path(app).map_err(|err| format!("获取播放状态路径失败: {err}"))?;
    set_music_session_file(path.clone());
    Ok(path)
}

fn write_json_atomic<T: Serialize>(path: &PathBuf, data: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(data)?;
    let tmp_path = path.with_extension(format!(
        "json.tmp-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::fs::write(&tmp_path, json)?;
    match std::fs::rename(&tmp_path, path) {
        Ok(_) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(err)
        }
    }
}

fn read_music_session() -> Option<MusicPlayerSession> {
    let path = get_music_session_file()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<MusicPlayerSession>(&content).ok()
}

fn is_meaningful_music_session_state(state: &MusicTrackState) -> bool {
    (state.playing || state.paused || state.paused_by_alarm)
        && state.playlist_id.is_some()
        && state.file_name.is_some()
}

fn persist_music_session_state(state: &MusicTrackState) -> std::io::Result<()> {
    if !is_meaningful_music_session_state(state) {
        return Ok(());
    }

    let Some(path) = get_music_session_file() else {
        return Ok(());
    };

    let session = MusicPlayerSession {
        state: state.clone(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    write_json_atomic(&path, &session)
}

pub fn prepare_music_player_session(app: &AppHandle) -> Result<(), String> {
    let _ = store_music_session_path(app)?;
    Ok(())
}

fn load_duration(sound_path: &str) -> Option<Duration> {
    let file = File::open(sound_path).ok()?;
    let decoder = Decoder::new(BufReader::new(file)).ok()?;
    decoder.total_duration()
}

fn build_sink() -> std::io::Result<Sink> {
    let handle = ensure_output_stream_handle().map_err(|err| {
        std::io::Error::other(format!("create shared output stream failed: {err}"))
    })?;
    let sink = Sink::try_new(&handle)
        .map_err(|err| std::io::Error::other(format!("create sink failed: {err}")))?;
    Ok(sink)
}

fn play_from_position(
    runtime: &mut AudioRuntime,
    state: &mut PlaybackState,
    position: Duration,
    play_now: bool,
) -> std::io::Result<()> {
    let sound_path = match state.sound_path.as_deref() {
        Some(path) => path,
        None => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "missing current track",
            ))
        }
    };

    if let Some(active_sink) = runtime.sink.as_ref() {
        active_sink.stop();
    }
    runtime.sink = None;
    let sink = build_sink()?;
    let file = File::open(sound_path)?;
    let decoder = Decoder::new(BufReader::new(file)).map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("decode track failed: {err}"),
        )
    })?;
    let skipped = decoder.skip_duration(position);

    if !play_now {
        sink.pause();
    }
    sink.set_volume(state.volume);
    sink.append(skipped);
    if play_now {
        sink.play();
    }

    runtime.sink = Some(sink);
    state.position = position;
    state.started_at = if play_now { Some(Instant::now()) } else { None };
    state.playing = true;
    state.paused = !play_now;
    Ok(())
}

fn ensure_worker() -> Sender<AudioCommand> {
    let mut guard = AUDIO_WORKER
        .lock()
        .expect("music audio worker mutex poisoned");
    if let Some(sender) = guard.as_ref() {
        return sender.clone();
    }

    let (tx, rx) = mpsc::channel::<AudioCommand>();
    thread::spawn(move || {
        let mut runtime = AudioRuntime { sink: None };
        let mut state = PlaybackState::new();

        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(command) => match command {
                    AudioCommand::Play {
                        playlist_id,
                        sound_path,
                        file_name,
                    } => {
                        state.file_name = Some(file_name);
                        state.playlist_id = Some(playlist_id);
                        state.sound_path = Some(sound_path.clone());
                        state.position = Duration::ZERO;
                        state.started_at = Some(Instant::now());
                        state.playing = true;
                        state.paused = false;
                        state.paused_by_alarm = false;
                        state.duration = load_duration(&sound_path);
                        if let Err(err) =
                            play_from_position(&mut runtime, &mut state, Duration::ZERO, true)
                        {
                            eprintln!("[music] play failed: {err}");
                            state = PlaybackState::new();
                            runtime = AudioRuntime { sink: None };
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::Pause => {
                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.pause();
                            state.position = state.current_position();
                            state.started_at = None;
                            state.paused = true;
                            state.paused_by_alarm = false;
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::PauseByAlarm => {
                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.pause();
                            state.position = state.current_position();
                            state.started_at = None;
                            state.paused = true;
                            state.paused_by_alarm = true;
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::Resume => {
                        if state.sound_path.is_some() {
                            if runtime.sink.is_some() {
                                if let Some(active_sink) = runtime.sink.as_ref() {
                                    active_sink.set_volume(state.volume);
                                    active_sink.play();
                                }
                                state.started_at = Some(Instant::now());
                                state.paused = false;
                                state.playing = true;
                                state.paused_by_alarm = false;
                            } else {
                                let resume_position = state.position;
                                if let Err(err) = play_from_position(
                                    &mut runtime,
                                    &mut state,
                                    resume_position,
                                    true,
                                ) {
                                    eprintln!("[music] resume failed: {err}");
                                }
                                state.paused_by_alarm = false;
                            }
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::Seek { position_ms } => {
                        let next_position = millis_to_duration(position_ms);
                        let was_playing = state.playing && !state.paused;
                        if state.sound_path.is_some() {
                            let seek_result = runtime
                                .sink
                                .as_ref()
                                .map(|sink| sink.try_seek(next_position));
                            match seek_result {
                                Some(Ok(())) => {
                                    if let Some(active_sink) = runtime.sink.as_ref() {
                                        if was_playing {
                                            active_sink.play();
                                        } else {
                                            active_sink.pause();
                                        }
                                    }
                                    state.position = next_position;
                                    state.started_at = if was_playing {
                                        Some(Instant::now())
                                    } else {
                                        None
                                    };
                                    state.playing = true;
                                    state.paused = !was_playing;
                                }
                                Some(Err(err)) => {
                                    eprintln!("[music] seek failed, fallback to rebuild: {err}");
                                    if let Err(err) = play_from_position(
                                        &mut runtime,
                                        &mut state,
                                        next_position,
                                        was_playing,
                                    ) {
                                        eprintln!("[music] seek fallback failed: {err}");
                                    }
                                }
                                None => {
                                    if let Err(err) = play_from_position(
                                        &mut runtime,
                                        &mut state,
                                        next_position,
                                        was_playing,
                                    ) {
                                        eprintln!("[music] seek failed: {err}");
                                    }
                                }
                            }
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::SetVolume { volume } => {
                        state.volume = clamp_volume(volume);
                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.set_volume(state.volume);
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::Stop => {
                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.stop();
                        }
                        let volume = state.volume;
                        state = PlaybackState::new_with_volume(volume);
                        runtime = AudioRuntime { sink: None };
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::Restore {
                        playlist_id,
                        sound_path,
                        file_name,
                        position_ms,
                        volume,
                        should_play,
                        paused_by_alarm,
                    } => {
                        state.file_name = Some(file_name);
                        state.playlist_id = Some(playlist_id);
                        state.sound_path = Some(sound_path.clone());
                        state.position = Duration::ZERO;
                        state.started_at = None;
                        state.playing = true;
                        state.paused = !should_play;
                        state.paused_by_alarm = paused_by_alarm;
                        state.volume = clamp_volume(volume);
                        state.duration = load_duration(&sound_path);

                        let resume_position = state
                            .duration
                            .map(|duration| millis_to_duration(position_ms).min(duration))
                            .unwrap_or_else(|| millis_to_duration(position_ms));

                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.stop();
                        }
                        runtime.sink = None;
                        match build_sink() {
                            Ok(sink) => {
                                match File::open(&sound_path).and_then(|file| {
                                    Decoder::new(BufReader::new(file)).map_err(|err| {
                                        std::io::Error::new(
                                            std::io::ErrorKind::InvalidData,
                                            format!("decode track failed: {err}"),
                                        )
                                    })
                                }) {
                                    Ok(decoder) => {
                                        sink.pause();
                                        sink.set_volume(state.volume);
                                        sink.append(decoder);
                                        if sink.try_seek(resume_position).is_err() {
                                            sink.stop();
                                            if let Err(err) = play_from_position(
                                                &mut runtime,
                                                &mut state,
                                                resume_position,
                                                should_play,
                                            ) {
                                                eprintln!("[music] restore failed: {err}");
                                                state = PlaybackState::new_with_volume(volume);
                                                runtime = AudioRuntime { sink: None };
                                            }
                                        } else {
                                            if should_play {
                                                sink.play();
                                            } else {
                                                sink.pause();
                                            }
                                            runtime.sink = Some(sink);
                                            state.position = resume_position;
                                            state.started_at = if should_play {
                                                Some(Instant::now())
                                            } else {
                                                None
                                            };
                                            state.playing = true;
                                            state.paused = !should_play;
                                        }
                                    }
                                    Err(err) => {
                                        eprintln!("[music] restore decoder open failed: {err}");
                                        state = PlaybackState::new_with_volume(volume);
                                        runtime = AudioRuntime { sink: None };
                                    }
                                }
                            }
                            Err(err) => {
                                eprintln!("[music] restore sink create failed: {err}");
                                state = PlaybackState::new_with_volume(volume);
                                runtime = AudioRuntime { sink: None };
                            }
                        }
                        if let Some(active_sink) = runtime.sink.as_ref() {
                            active_sink.set_volume(state.volume);
                            if should_play {
                                active_sink.play();
                            } else {
                                active_sink.pause();
                            }
                        }
                        if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                            *snapshot = state.snapshot();
                        }
                        let _ = persist_music_session_state(&state.snapshot());
                    }
                    AudioCommand::QueryState { respond_to } => {
                        let snapshot = state.snapshot();
                        let _ = respond_to.send(snapshot.clone());
                        if let Ok(mut cached) = PLAYBACK_STATE.lock() {
                            *cached = snapshot;
                        }
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(active_sink) = runtime.sink.as_ref() {
                        if !state.paused && state.playing && active_sink.empty() {
                            state.position = state.duration.unwrap_or(Duration::ZERO);
                            state.started_at = None;
                            state.playing = false;
                            state.paused = false;
                            if let Ok(mut snapshot) = PLAYBACK_STATE.lock() {
                                *snapshot = state.snapshot();
                            }
                            runtime.sink = None;
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    *guard = Some(tx.clone());
    tx
}

#[tauri::command]
pub async fn play_music_track(
    app: AppHandle,
    playlist_id: String,
    music_sound_file: String,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let file_name = music_sound_file.trim();
    if file_name.is_empty() {
        return err_payload(ErrorCode::InvalidPath, "请选择音乐文件".to_string(), trace);
    }

    let sender = ensure_worker();
    let sound_path = match ensure_music_sound_available(&app, &playlist_id, file_name).await {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取音乐文件路径失败: {err}"),
                trace,
            )
        }
    };

    if let Err(err) = sender.send(AudioCommand::Play {
        playlist_id,
        sound_path,
        file_name: file_name.to_string(),
    }) {
        return err_payload(
            ErrorCode::IoError,
            format!("发送音乐播放指令失败: {err}"),
            trace,
        );
    }
    ok((), trace)
}

#[tauri::command]
pub async fn pause_music_track() -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::Pause) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐暂停指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn pause_music_track_by_alarm() -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::PauseByAlarm) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐闹钟暂停指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn resume_music_track() -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::Resume) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐继续指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn seek_music_track(position_ms: u64) -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::Seek { position_ms }) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐定位指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn set_music_track_volume(volume: f32) -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::SetVolume { volume }) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐音量指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn stop_music_track() -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::Stop) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送音乐停止指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}

#[tauri::command]
pub async fn save_music_session(state: MusicTrackState) -> ResultPayload<()> {
    let trace = new_trace_id();
    match persist_music_session_state(&state) {
        Ok(_) => ok((), trace),
        Err(err) => err_payload(
            ErrorCode::IoError,
            format!("保存播放状态失败: {err}"),
            trace,
        ),
    }
}

#[tauri::command]
pub async fn restore_music_session(app: AppHandle) -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Err(err) = store_music_session_path(&app) {
        return err_payload(ErrorCode::IoError, err, trace);
    }
    let Some(session) = read_music_session() else {
        return ok((), trace);
    };
    let state = session.state;
    if !state.playing && !state.paused && !state.paused_by_alarm {
        return ok((), trace);
    }
    let Some(playlist_id) = state.playlist_id.as_deref() else {
        return ok((), trace);
    };
    let Some(file_name) = state.file_name.as_deref() else {
        return ok((), trace);
    };

    let sound_path = match ensure_music_sound_available(&app, playlist_id, file_name).await {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("恢复播放状态失败: {err}"),
                trace,
            )
        }
    };

    let sender = ensure_worker();
    if let Err(err) = sender.send(AudioCommand::Restore {
        playlist_id: playlist_id.to_string(),
        sound_path,
        file_name: file_name.to_string(),
        position_ms: state.position_ms,
        volume: state.volume,
        should_play: state.playing && !state.paused && !state.paused_by_alarm,
        paused_by_alarm: state.paused_by_alarm,
    }) {
        return err_payload(
            ErrorCode::IoError,
            format!("恢复播放状态失败: {err}"),
            trace,
        );
    }
    ok((), trace)
}

#[tauri::command]
pub async fn restore_music_track(
    app: AppHandle,
    playlist_id: String,
    music_sound_file: String,
    position_ms: u64,
    volume: f32,
    should_play: bool,
    paused_by_alarm: bool,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let file_name = music_sound_file.trim();
    if file_name.is_empty() {
        return err_payload(ErrorCode::InvalidPath, "请选择音乐文件".to_string(), trace);
    }

    let sender = ensure_worker();
    let sound_path = match ensure_music_sound_available(&app, &playlist_id, file_name).await {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取音乐文件路径失败: {err}"),
                trace,
            )
        }
    };

    if let Err(err) = sender.send(AudioCommand::Restore {
        playlist_id,
        sound_path,
        file_name: file_name.to_string(),
        position_ms,
        volume,
        should_play,
        paused_by_alarm,
    }) {
        return err_payload(
            ErrorCode::IoError,
            format!("发送音乐恢复指令失败: {err}"),
            trace,
        );
    }
    ok((), trace)
}

#[tauri::command]
pub async fn get_music_track_state() -> ResultPayload<MusicTrackState> {
    let trace = new_trace_id();
    let fallback_snapshot = PLAYBACK_STATE
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default();

    let sender = match AUDIO_WORKER.lock() {
        Ok(guard) => guard.as_ref().cloned(),
        Err(_) => None,
    };

    let Some(sender) = sender else {
        return ok(fallback_snapshot, trace);
    };

    let (respond_to, receive_from) = oneshot::channel::<MusicTrackState>();
    if sender
        .send(AudioCommand::QueryState { respond_to })
        .is_err()
    {
        return ok(fallback_snapshot, trace);
    }

    match tokio::time::timeout(Duration::from_millis(200), receive_from).await {
        Ok(Ok(snapshot)) => ok(snapshot, trace),
        _ => ok(fallback_snapshot, trace),
    }
}

#[tauri::command]
pub async fn get_music_track_duration(
    app: AppHandle,
    playlist_id: String,
    music_sound_file: String,
) -> ResultPayload<Option<u64>> {
    let trace = new_trace_id();
    let file_name = music_sound_file.trim();
    if file_name.is_empty() {
        return ok(None, trace);
    }

    let sound_path = match ensure_music_sound_available(&app, &playlist_id, file_name).await {
        Ok(path) => path,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取音乐文件路径失败: {err}"),
                trace,
            )
        }
    };

    let duration = load_duration(&sound_path.to_string_lossy());
    ok(duration.map(duration_to_millis), trace)
}
