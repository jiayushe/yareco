# Yareco

[![License](https://img.shields.io/github/license/jiayushe/yareco)](https://github.com/jiayushe/yareco/blob/master/LICENSE)
![npm](https://img.shields.io/npm/v/yareco.svg)

## Introduction

Yareco stands for yet another recorder. It is a lightweight wrapper around the web recorder API, adapted from online resources, rewritten in TypeScript.

## API

- `Recorder.start()`
- `Recorder.pause()`
- `Recorder.resume(position: number = -1)`
- `Recorder.stop()`
- `Recorder.clear()`
- `Recorder.exportWAV()`

## Motivation

I needed to support rewinding while recording, but there is no library that supports this feature. So I decided to rebuild my own.
