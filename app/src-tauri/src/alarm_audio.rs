use crate::alarm_sound::ensure_alarm_sound_available;
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use once_cell::sync::Lazy;
use rodio::{source::SineWave, Decoder, OutputStream, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::{
    mpsc::{self, Sender},
    Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

enum AudioCommand {
    Play { sound_path: Option<String> },
    Stop,
}

static AUDIO_WORKER: Lazy<Mutex<Option<Sender<AudioCommand>>>> = Lazy::new(|| Mutex::new(None));

fn ensure_worker() -> Sender<AudioCommand> {
    let mut guard = AUDIO_WORKER.lock().expect("alarm audio worker mutex poisoned");
    if let Some(sender) = guard.as_ref() {
        return sender.clone();
    }

    let (tx, rx) = mpsc::channel::<AudioCommand>();
    thread::spawn(move || {
        let mut _stream: Option<OutputStream> = None;
        let mut sink: Option<Sink> = None;

        for command in rx {
            match command {
                AudioCommand::Play { sound_path } => {
                    if let Some(active_sink) = sink.as_ref() {
                        active_sink.stop();
                    }
                    sink = None;
                    _stream = None;

                    match OutputStream::try_default() {
                        Ok((next_stream, handle)) => match Sink::try_new(&handle) {
                            Ok(next_sink) => {
                                _stream = Some(next_stream);
                                sink = Some(next_sink);
                            }
                            Err(err) => {
                                eprintln!("[alarm] create sink failed: {err}");
                                continue;
                            }
                        },
                        Err(err) => {
                            eprintln!("[alarm] create output stream failed: {err}");
                            continue;
                        }
                    }

                    if let Some(active_sink) = sink.as_ref() {
                        if let Some(path) = sound_path.as_deref() {
                            match File::open(path) {
                                Ok(file) => match Decoder::new(BufReader::new(file)) {
                                    Ok(source) => {
                                        active_sink.append(source.repeat_infinite());
                                        active_sink.play();
                                        continue;
                                    }
                                    Err(err) => {
                                        eprintln!("[alarm] decode alarm sound failed: {err}");
                                    }
                                },
                                Err(err) => {
                                    eprintln!("[alarm] open alarm sound failed: {err}");
                                }
                            }
                        }

                        let tone = SineWave::new(880.0)
                            .amplify(0.12)
                            .take_duration(Duration::from_millis(900));
                        active_sink.append(tone.repeat_infinite());
                        active_sink.play();
                    }
                }
                AudioCommand::Stop => {
                    if let Some(active_sink) = sink.as_ref() {
                        active_sink.stop();
                    }
                    sink = None;
                    _stream = None;
                }
            }
        }
    });

    *guard = Some(tx.clone());
    tx
}

#[tauri::command]
pub async fn play_alarm_sound(
    app: AppHandle,
    alarm_sound_file: Option<String>,
) -> ResultPayload<()> {
    let trace = new_trace_id();
    let sender = ensure_worker();
    let sound_path = match alarm_sound_file.as_deref() {
        Some(file_name) if !file_name.trim().is_empty() => match ensure_alarm_sound_available(&app, file_name).await {
            Ok(path) => Some(path.to_string_lossy().to_string()),
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("获取闹钟音频路径失败: {err}"),
                    trace,
                )
            }
        },
        _ => None,
    };

    if let Err(err) = sender.send(AudioCommand::Play { sound_path }) {
        return err_payload(
            ErrorCode::IoError,
            format!("发送闹钟播放指令失败: {err}"),
            trace,
        );
    }
    ok((), trace)
}

#[tauri::command]
pub async fn stop_alarm_sound() -> ResultPayload<()> {
    let trace = new_trace_id();
    if let Ok(guard) = AUDIO_WORKER.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(err) = sender.send(AudioCommand::Stop) {
                return err_payload(
                    ErrorCode::IoError,
                    format!("发送闹钟停止指令失败: {err}"),
                    trace,
                );
            }
        }
    }
    ok((), trace)
}
