# Remote

[English](README.md) · **한국어**

사무실의 다른 컴퓨터 화면을 모니터별로 보고, 원격으로 클릭하고 글자를 칩니다. 나중에는 Claude 세션도 MCP 도구로 같은 원격 화면을 쓸 수 있게 합니다.

Remote 는 RUNNERS-IM 이 사무실 컴퓨터를 위해 만드는 앱입니다. Monitor 처럼 [Electron](https://www.electronjs.org) 과 Rust 네이티브 모듈 하나로 짭니다.

**Remote 는 아직 만드는 중이고 배포한 판이 없습니다.** 지금은 맥 한 대 안에서만 돕니다. 다른 컴퓨터와 연결하지 않고, 네트워크에서 연결을 기다리지도 않습니다.

## 지금 되는 것 (1단계: macOS 받는 쪽)

- 메뉴 막대에만 뜨고 Dock 에는 아이콘이 없습니다. 메뉴 막대 그림이 상태를 보여 줍니다: **원격 꺼짐** 이면 테두리만, **대기 중** 이면 화살표, **보는 중** 이면 화살표가 움직입니다. 꺼져 있으면 상태 줄에 이유(**macOS 전용** 또는 **화면 기록 권한 필요**)를 붙입니다.
- 메뉴 막대 아이콘을 누르면 패널이 열리고, 오른쪽 클릭하면 같은 줄이 Monitor 와 같은 묶음으로 나오는 메뉴가 열립니다: 상태 줄, Remote 열기, 로그인할 때 열기, 업데이트 자동 확인, Remote 정보, 업데이트 확인…, 도움말 · 피드백, Remote 종료. 패널에는 화면 기록 · 손쉬운 사용 권한이 켜졌는지와 권한마다 **허용…** 버튼도 있습니다.
- Remote 창에는 이 맥의 모니터가 탭으로 나오고, 고른 모니터의 화면이 초당 5장쯤 실시간으로 나옵니다. 화면은 ScreenCaptureKit 으로 찍어 JPEG 로 창에 보냅니다.
- Remote 에 필요한 맥 권한은 두 가지입니다.
  - **화면 기록**: 화면을 찍는 데 필요합니다
  - **손쉬운 사용**: 클릭과 키 입력을 넣는 데 필요합니다
- 클릭은 CGEvent 로 넣고, 위치는 고른 모니터 기준으로 바꿔 계산합니다. 창에서는 **클릭 보내기** 스위치를 켰을 때만 동작합니다. 이 스위치는 켤 때마다 꺼진 상태로 시작하고, 창을 닫으면 다시 꺼집니다. 꺼져 있으면 화면을 눌러도 아무 일도 일어나지 않습니다.
- 하루 한 번 업데이트를 확인하고([PRIVACY.md](PRIVACY.md) 참고), 그 줄을 끄지 않으면 로그인할 때 열립니다.
- 화면 글자는 20개 언어로 나옵니다: 한국어, 영어, 일본어, 중국어(간체), 중국어(번체), 독일어, 프랑스어, 스페인어, 포르투갈어, 이탈리아어, 네덜란드어, 핀란드어, 폴란드어, 러시아어, 터키어, 아랍어, 힌디어, 태국어, 베트남어, 인도네시아어.

## 계획

1. macOS 받는 쪽: 모니터별 화면 찍기, 클릭 · 키 입력 받기 (진행 중)
2. 보는 쪽: 컴퓨터 목록, 모니터 탭, 화면 보기 · 누르기 · 입력
3. 연결: 컴퓨터들이 우리 전용 망(libtailscale + 우리 Headscale 서버)에 들어오고, Remote 는 그 망에서 오는 연결만 받습니다. 접속 기록, "보는 중" 표시, 한 번에 끊는 버튼을 함께 넣습니다
4. Claude 세션용 MCP 도구. 허용 목록 밖의 앱과 맥 보안 창은 사람 승인을 받습니다
5. 윈도우 · 리눅스 받는 쪽, 보는 쪽 휴대폰 앱

## 소스에서 빌드하기

macOS 14 이상, [Rust](https://rustup.rs), Node.js 20 이상, pnpm 이 필요합니다.

```sh
pnpm install
pnpm native         # 이 컴퓨터용 네이티브 모듈(native/) 빌드
pnpm dev            # 고치면 바로 다시 켜지는 개발 실행
pnpm dist           # 이 OS 용 앱을 dist.noindex/ 에 만들기
pnpm check:locales  # 모든 언어 파일을 ko.json 과 맞춰 보기
```

Apple 실리콘 맥에서 인텔 맥용으로도 만들려면 `rustup target add x86_64-apple-darwin` 뒤 `pnpm native --target x86_64-apple-darwin` 도 실행합니다.

- `electron/main/` 은 메인 프로세스(메뉴 막대 아이콘, 패널 · 화면 보기 · 정보 창, 상태, 업데이트), `electron/preload/` 는 화면이 메인 프로세스와 말하는 다리, `src/` 는 패널 · 화면 보기 · 정보 화면입니다.
- `native/` 는 네이티브 모듈 하나(napi-rs)입니다: 화면 찍기, 클릭 넣기, 권한 확인, 메뉴 막대 그림.
- 화면 글자는 `locales/` 에 있고 `ko.json` 이 기준입니다. 화면과 메인 프로세스가 같은 파일을 읽습니다.
- 개발 실행에서는 `REMOTE_OPEN=panel|viewer|about`, `REMOTE_THEME=dark|light` 를 씁니다. 설치한 앱은 이 값을 무시합니다.

`pnpm dev` 로 켜면 맥은 Remote 가 아니라 Remote 를 띄운 터미널 앱에 권한을 묻습니다.

지금까지는 macOS(Apple 실리콘)에서만 빌드하고 확인했습니다. 윈도우와 리눅스에서는 "Remote는 지금 macOS에서만 쓸 수 있습니다."만 띄웁니다.

## 지우는 방법

1. 메뉴 막대에서 **Remote 종료** 를 고릅니다.
2. 응용 프로그램 폴더의 Remote 를 휴지통으로 옮깁니다.
3. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음, 손쉬운 사용에서 Remote 를 지웁니다. 또는 터미널에서 실행합니다.

```sh
tccutil reset ScreenCapture im.runners.remote
tccutil reset Accessibility im.runners.remote
```

## 개인정보

Remote 는 아무것도 모으거나 보내지 않습니다. [PRIVACY.md](PRIVACY.md) 를 보세요.

## 라이선스

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. 코드는 읽어 볼 수 있게 공개했을 뿐이고, 허락 없이 복사 · 수정 · 재배포할 수 없습니다. [LICENSE.md](LICENSE.md) 를 보세요.
