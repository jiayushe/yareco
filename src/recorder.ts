export default class Recorder {
  private context: any;
  private stream: any;
  private audioInput: any;
  private analyser: any;
  private recorder: any;
  private buffer: { data: Float32Array[]; size: number }[];
  private isRecording: boolean;
  private numChannels: number;
  private inputSampleRate: number;
  private outputSampleRate: number;
  private outputSampleBits: number;
  private duration: number = 0;
  private littleEdian: boolean = true;
  public onRecord: (duration: number) => void;

  constructor(config: UserConfig = {}) {
    this.numChannels = config.numChannels
      ? [1, 2].indexOf(config.numChannels) >= 0
        ? config.numChannels!
        : 2
      : 2;
    this.inputSampleRate = new (window.AudioContext ||
      window.webkitAudioContext)().sampleRate;
    this.outputSampleRate = config.sampleBits
      ? [8, 16].indexOf(config.sampleBits) >= 0
        ? config.sampleBits!
        : 16
      : 16;
    this.outputSampleBits = config.sampleRate
      ? [8000, 11025, 16000, 22050, 24000, 44100, 48000].indexOf(
          config.sampleRate
        ) >= 0
        ? config.sampleRate!
        : this.inputSampleRate
      : this.inputSampleRate;
    this.littleEdian = (() => {
      const buffer = new ArrayBuffer(2);
      new DataView(buffer).setInt16(0, 256, true);
      return new Int16Array(buffer)[0] === 256;
    })();
    Recorder.initUserMedia();
  }

  async start(): Promise<{}> {
    this.initRecorder();
    return navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream: any) => {
        this.stream = stream;
        this.audioInput = this.context.createMediaStreamSource(stream);
      })
      .then(() => {
        this.audioInput.connect(this.analyser);
        this.analyser.connect(this.recorder);
        this.recorder.connect(this.context.destination);
      });
  }

  pause(): void {
    this.isRecording = false;
  }

  resume(position: number = -1): void {
    this.isRecording = true;
    if (position >= 0) {
      const targetPos = Math.round(position * this.inputSampleRate);
      const length = this.buffer[0].data.length;
      let startPos = 0;
      for (let i = 0; i < length; i++) {
        const curLength = this.buffer[0].data[i].length;
        const endPos = startPos + curLength;
        if (endPos <= targetPos) {
          const curPos = targetPos - startPos;
          if (curPos < curLength) {
            for (let chan = 0; chan < this.numChannels; chan += 1) {
              this.buffer[chan].data[i] = this.buffer[chan].data[i].slice(
                0,
                curPos
              );
            }
          }
          for (let chan = 0; chan < this.numChannels; chan += 1) {
            this.buffer[chan].data.splice(i + 1);
            this.buffer[chan].size = targetPos;
          }
          this.duration = targetPos / this.inputSampleRate;
        }
        startPos = endPos;
      }
    }
  }

  stop(): void {
    this.recorder.disconnect();
    this.analyser.disconnect();
    if (this.audioInput) this.audioInput.disconnect();
  }

  clear(): Promise<{}> {
    this.clearRecordStatus();
    this.stopStream();
    return this.closeAudioContext();
  }

  exportWAV(): Blob {
    return new Blob([this.getWAV()], { type: "audio/wav" });
  }

  private initRecorder(): void {
    this.clear();
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.context.createAnalyser();
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.fftSize = 2048;
    const scriptProcessor =
      this.context.createScriptProcessor || this.context.createJavaScriptNode;
    const sampleSize = 4096;
    this.recorder = scriptProcessor.apply(this.context, [
      sampleSize,
      this.numChannels,
      this.numChannels,
    ]);
    this.recorder.onaudioprocess = (e: any) => {
      if (!this.isRecording) return;
      for (let chan = 0; chan < this.numChannels; chan++) {
        const data = e.inputBuffer.getChannelData(chan);
        this.buffer[chan].data.push(new Float32Array(data));
        this.buffer[chan].size += data.length;
      }
      this.duration += sampleSize / this.inputSampleRate;
      if (this.onRecord) this.onRecord(this.duration);
    };
  }

  private clearRecordStatus(): void {
    this.audioInput = null;
    this.isRecording = true;
    this.duration = 0;
    for (let chan = 0; chan < this.numChannels; chan++) {
      this.buffer[chan] = { data: [], size: 0 };
    }
  }

  private stopStream(): void {
    if (this.stream && this.stream.getTracks) {
      this.stream.getTracks().forEach((track: any) => track.stop());
      this.stream = null;
    }
  }

  private closeAudioContext(): Promise<{}> {
    if (this.context && this.context.close && this.context.state !== "closed") {
      return this.context.close();
    } else {
      return new Promise((resolve: () => any) => {
        resolve();
      });
    }
  }

  private getBuffer(): any {
    const buffer = [];
    for (let chan = 0; chan < this.numChannels; chan++) {
      const data = new Float32Array(this.buffer[chan].size);
      let offset = 0;
      for (const curData of this.buffer[chan].data) {
        data.set(curData, offset);
        offset += curData.length;
      }
      buffer.push(data);
    }
    if (this.numChannels === 1) {
      buffer.push(new Float32Array(0));
    }
    return buffer;
  }

  private compress(): Float32Array {
    const input = this.getBuffer();
    const compression = Math.max(
      this.inputSampleRate / this.outputSampleRate,
      1
    );
    const length = Math.floor(
      (input[0].length + input[1].length) / compression
    );
    const output = new Float32Array(length);
    let inputIndex = 0;
    let outputIndex = 0;
    while (outputIndex < length) {
      const pos = Math.floor(inputIndex);
      output[outputIndex] = input[0][pos];
      outputIndex++;
      if (input[1].length) {
        output[outputIndex] = input[1][pos];
        outputIndex++;
      }
      inputIndex += compression;
    }
    return output;
  }

  private getPCM(): DataView {
    const input = this.compress();
    const dataLength = input.length * (this.outputSampleBits / 8);
    const buffer = new ArrayBuffer(dataLength);
    const output = new DataView(buffer);
    let offset = 0;
    if (this.outputSampleBits === 8) {
      for (let i = 0; i < input.length; i++, offset++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        // 8-bit [0, 255]
        output.setInt8(offset, (s < 0 ? s * 128 : s * 127) + 128);
      }
    } else {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        // 16-bit [-32768, 32767]
        output.setInt16(
          offset,
          s < 0 ? s * 0x8000 : s * 0x7fff,
          this.littleEdian
        );
      }
    }
    return output;
  }

  private getWAV(): DataView {
    const input = this.getPCM();
    const sampleRate =
      this.outputSampleRate > this.inputSampleRate
        ? this.inputSampleRate
        : this.outputSampleRate;
    const sampleBits = this.outputSampleBits;
    const channelCount = this.numChannels;
    const buffer = new ArrayBuffer(44 + input.byteLength);
    const output = new DataView(buffer);
    let offset = 0;
    const writeString = (data: any, pos: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        data.setUint8(pos + i, str.charCodeAt(i));
      }
    };
    /* RIFF identifier */
    writeString(output, offset, "RIFF");
    offset += 4;
    /* RIFF chunk length */
    output.setUint32(offset, 36 + input.byteLength, this.littleEdian);
    offset += 4;
    /* RIFF type */
    writeString(output, offset, "WAVE");
    offset += 4;
    /* format chunk identifier */
    writeString(output, offset, "fmt ");
    offset += 4;
    /* format chunk length */
    output.setUint32(offset, 16, this.littleEdian);
    offset += 4;
    /* sample format (raw) */
    output.setUint16(offset, 1, this.littleEdian);
    offset += 2;
    /* channel count */
    output.setUint16(offset, channelCount, this.littleEdian);
    offset += 2;
    /* sample rate */
    output.setUint32(offset, sampleRate, this.littleEdian);
    offset += 4;
    /* byte rate (sample rate * block align) */
    output.setUint32(
      offset,
      channelCount * sampleRate * (sampleBits / 8),
      this.littleEdian
    );
    offset += 4;
    /* block align (channel count * bytes per sample) */
    output.setUint16(offset, channelCount * (sampleBits / 8), this.littleEdian);
    offset += 2;
    /* bits per sample */
    output.setUint16(offset, sampleBits, this.littleEdian);
    offset += 2;
    /* data chunk identifier */
    writeString(output, offset, "data");
    offset += 4;
    /* data chunk length */
    output.setUint32(offset, input.byteLength, this.littleEdian);
    offset += 4;
    /* data */
    for (let i = 0; i < input.byteLength; offset++, i++) {
      output.setUint8(offset, input.getUint8(i));
    }
    return output;
  }

  static initUserMedia(): any {
    if (navigator.mediaDevices === undefined) {
      navigator.mediaDevices = {};
    }
    if (navigator.mediaDevices.getUserMedia === undefined) {
      navigator.mediaDevices.getUserMedia = (constraints: any) => {
        const getUserMedia =
          navigator.getUserMedia ||
          navigator.webkitGetUserMedia ||
          navigator.mozGetUserMedia;
        if (!getUserMedia) {
          return Promise.reject(new Error("Browser is not supported."));
        }
        return new Promise((resolve: any, reject: any) => {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }
  }

  static async getPermission(): Promise<{}> {
    Recorder.initUserMedia();
    return navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream: any) => {
        stream.getTracks().forEach((track: any) => track.stop());
      });
  }
}

declare let navigator: any;
declare let window: any;

interface UserConfig {
  numChannels?: number;
  sampleBits?: number;
  sampleRate?: number;
}
