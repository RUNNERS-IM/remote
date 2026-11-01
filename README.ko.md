# Remote

[English](README.md) · **한국어**

사무실의 다른 컴퓨터 화면을 모니터별로 보고, 원격으로 클릭하고 글자를 칩니다. Claude 세션도 MCP 도구로 같은 원격 화면을 씁니다.

Remote 는 RUNNERS-IM 이 사무실 컴퓨터를 위해 만드는 앱입니다. Monitor 처럼 [Electron](https://www.electronjs.org) 과 Rust 네이티브 모듈 하나로 짭니다.

**Remote 는 아직 만드는 중입니다.** 첫 공개 판은 2.6.1102 입니다([Releases](https://github.com/RUNNERS-IM/remote/releases)). 컴퓨터끼리 이으려면 연결 서버(Headscale)가 필요합니다. 컴퓨터 탭 아래 칸에 서버를 넣기 전까지 Remote 는 자기가 도는 컴퓨터만 보여 줍니다.

## 지금 되는 것

- 메뉴 막대에만 뜨고 Dock 에는 아이콘이 없습니다. 메뉴 막대 그림이 상태를 보여 줍니다: **원격 꺼짐** 이면 테두리만, **대기 중** 이면 화살표, **보는 중** 이면 화살표가 움직입니다. 꺼져 있으면 상태 줄에 이유(**macOS 전용** 또는 **화면 기록 권한 필요**)를 붙입니다.
- 메뉴 막대 아이콘을 누르면 패널이 열리고, 오른쪽 클릭하면 같은 줄이 Monitor 와 같은 묶음으로 나오는 메뉴가 열립니다: 상태 줄, Remote 열기, 로그인할 때 열기, 업데이트 자동 확인, Remote 정보, 업데이트 확인…, 도움말 · 피드백, Remote 종료. 패널에는 화면 기록 · 손쉬운 사용 권한이 켜졌는지와 권한마다 **허용…** 버튼도 있습니다.
- Remote 창에는 이 맥의 모니터가 탭으로 나오고, 고른 모니터의 화면이 초당 5장쯤 실시간으로 나옵니다. 화면은 ScreenCaptureKit 으로 찍어 JPEG 로 창에 보냅니다.
- Remote 에 필요한 맥 권한은 두 가지입니다.
  - **화면 기록**: 화면을 찍는 데 필요합니다
  - **손쉬운 사용**: 클릭과 키 입력을 넣는 데 필요합니다
- 클릭은 CGEvent 로 넣고, 위치는 고른 모니터 기준으로 바꿔 계산합니다. 창에서는 **클릭 보내기** 스위치를 켰을 때만 동작합니다. 이 스위치는 켤 때마다 꺼진 상태로 시작하고, 창을 닫으면 다시 꺼집니다. 꺼져 있으면 화면을 눌러도 아무 일도 일어나지 않습니다.
- **다른 컴퓨터 보기**(2 · 3단계): Remote 마다 `remote-link`(`link/`, Go 로 쓴 연결 프로그램. Tailscale 의 tsnet 라이브러리를 씁니다)로 우리 연결 서버를 거쳐 우리 전용 망에 들어갑니다. 그러면 Remote 창에 컴퓨터마다 탭이 생기고, 고르면 그 컴퓨터의 모니터와 화면이 똑같이 나옵니다. **클릭 보내기** 를 켜면 화면을 누른 자리를 그 컴퓨터에서 클릭하고, 누른 뒤 치는 키도 그 컴퓨터로 갑니다(한글처럼 조합하는 글자는 아래 글자 칸으로 보냅니다). Remote 는 그 망 주소에서만 연결을 받고, 요청마다 망이 확인해 준 보낸 컴퓨터 이름이 붙습니다.
- **연결 서버**: 배포하는 Remote 에는 정해 둔 서버가 없습니다. 컴퓨터 탭 아래 칸에 직접 넣거나, 사무실 링크 `remote://join?server=remote.example.com` 을 눌러 넣습니다(맥에서는 `open "remote://join?server=…"` 도 같습니다). 링크로 넣을 때는 그 컴퓨터 앞의 사람이 한 번 확인합니다. https 주소만 받습니다. 처음 들어온 컴퓨터는 관리자가 그 서버에서 승인할 때까지 기다립니다.
- 보이는 쪽 컴퓨터: 패널과 메뉴의 **다른 컴퓨터에 이 화면 보이기**(처음엔 켜짐), **다른 컴퓨터의 클릭 · 키 입력 허용**(처음엔 꺼짐), 누가 보는지 함께 나오는 노란 **보는 중** 상태, 보기를 바로 끄는 **지금 끊기**, Remote 창의 접속 기록(누가 보기 시작 · 클릭 · 키 입력 · 글자 입력을 했는지. 친 글자 내용은 적지 않습니다).
- **Claude**(4단계): `resources/mcp/remote-mcp.mjs` 는 도구 여섯 개를 주는 MCP 서버입니다: `remote_computers`, `remote_displays`, `remote_screenshot`, `remote_click`, `remote_type`, `remote_key`. 보기는 승인이 필요 없습니다(보이는 쪽 스위치가 정합니다). 클릭 · 입력은 허용 목록을 따릅니다: 목록에 있는 앱이면 바로 하고, 다른 앱이면 Claude 가 도는 컴퓨터 앞의 사람이 먼저 승인하며 그때 그 앱을 목록에 넣을 수 있습니다. 맥 보안 창(암호 입력 창, 시스템 설정)은 매번 사람이 승인합니다. 상대 컴퓨터의 **클릭 · 키 입력 허용** 이 꺼져 있으면 아무에게도 묻지 않고 거절합니다.
- 하루 한 번 업데이트를 확인하고([PRIVACY.md](PRIVACY.md) 참고), 그 줄을 끄지 않으면 로그인할 때 열립니다.
- 화면 글자는 20개 언어로 나옵니다: 한국어, 영어, 일본어, 중국어(간체), 중국어(번체), 독일어, 프랑스어, 스페인어, 포르투갈어, 이탈리아어, 네덜란드어, 핀란드어, 폴란드어, 러시아어, 터키어, 아랍어, 힌디어, 태국어, 베트남어, 인도네시아어.

## 계획

1. macOS 받는 쪽: 모니터별 화면 찍기, 클릭 · 키 입력 받기 (끝)
2. 보는 쪽: 컴퓨터 목록, 모니터 탭, 화면 보기 · 누르기 · 입력 (끝)
3. 연결: 우리 전용 망(tsnet + 우리 Headscale 서버), 접속 기록, "보는 중" 표시, 한 번에 끊는 버튼 (끝. 맥 한 대 안의 Headscale 로 시험했고, 사무실용 서버는 아직 세우지 않았습니다)
4. Claude 세션용 MCP 도구와 승인 (끝)
5. 윈도우 · 리눅스 받는 쪽, 보는 쪽 휴대폰 앱 (시작 안 함. 윈도우 · 리눅스 판은 다른 컴퓨터를 볼 수는 있지만 보여질 수는 없습니다)

## Claude 와 같이 쓰기

```sh
claude mcp add remote -- env ELECTRON_RUN_AS_NODE=1 /Applications/Remote.app/Contents/MacOS/Remote \
  /Applications/Remote.app/Contents/Resources/mcp/remote-mcp.mjs
```

Remote 가 켜져 있어야 합니다. 이 스크립트는 그 사용자만 열 수 있는 소켓(응용 프로그램 지원 폴더의 Remote 폴더 안
`claude.sock`)으로 Remote 와 말합니다.

## 소스에서 빌드하기

macOS 14 이상, [Rust](https://rustup.rs), Node.js 20 이상, pnpm 이 필요합니다.

```sh
pnpm install
pnpm native         # 이 컴퓨터용 네이티브 모듈(native/) 빌드
pnpm link:build     # 이 컴퓨터용 remote-link(link/) 빌드. Go 가 필요합니다
pnpm dev            # 고치면 바로 다시 켜지는 개발 실행
pnpm dist           # 이 OS 용 앱을 dist.noindex/ 에 만들기
pnpm check:locales  # 모든 언어 파일을 ko.json 과 맞춰 보기
```

Apple 실리콘 맥에서 인텔 맥용으로도 만들려면 `rustup target add x86_64-apple-darwin` 뒤 `pnpm native --target x86_64-apple-darwin` 도 실행합니다.

- `electron/main/` 은 메인 프로세스(메뉴 막대 아이콘, 패널 · 화면 보기 · 정보 창, 상태, 업데이트), `electron/preload/` 는 화면이 메인 프로세스와 말하는 다리, `src/` 는 패널 · 화면 보기 · 정보 화면입니다.
- `native/` 는 네이티브 모듈 하나(napi-rs)입니다: 화면 찍기, 클릭 넣기, 앞에 있는 앱 알아내기, 권한 확인, 메뉴 막대 그림.
- `link/` 는 Remote 가 켜는 연결 프로그램 `remote-link` 입니다(맥 한 대로 시험 망 만들기는 [link/README.md](link/README.md)). `electron/main/link.ts` 가 그것을 켜고 다른 컴퓨터의 요청을 받으며, `electron/main/claude.ts` 가 MCP 스크립트의 요청을 받습니다.
- 화면 글자는 `locales/` 에 있고 `ko.json` 이 기준입니다. 화면과 메인 프로세스가 같은 파일을 읽습니다.
- 개발 실행에서는 `REMOTE_OPEN=panel|viewer|about`, `REMOTE_THEME=dark|light` 를 씁니다. 설치한 앱은 이 값을 무시합니다.

`pnpm dev` 로 켜면 맥은 Remote 가 아니라 Remote 를 띄운 터미널 앱에 권한을 묻습니다.

지금까지는 macOS(Apple 실리콘)에서만 빌드하고 확인했습니다. 윈도우와 리눅스에서는 "Remote는 지금 macOS에서만 쓸 수 있습니다."만 띄웁니다.

## 배포하기

`release` 브랜치로 합치면 배포 판을 만들어 올립니다(`.github/workflows/release.yml`). 그 전에 이번 판의 바뀐 점을
`RELEASE_NOTES.md` 에 적습니다. 이 글이 GitHub 릴리스 본문이 되고, 업데이트 창이 그 목록을 "바뀐 점" 아래에 보여 줍니다.

```md
## 한국어

- 한 줄에 바뀐 점 하나씩, 합니다체로 씁니다.

## English

- One change per line.
```

한국어 화면은 `## 한국어` 목록을, 다른 언어는 모두 `## English` 목록을 읽습니다. 버전 올리기(`scripts/bump-release.sh`)는
두 목록 중 하나가 비었거나 지난 판의 글 그대로면 멈춥니다.

## 지우는 방법

1. 메뉴 막대에서 **Remote 종료** 를 고릅니다.
2. 응용 프로그램 폴더의 Remote 를 휴지통으로 옮깁니다.
3. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 녹음, 손쉬운 사용에서 Remote 를 지웁니다. 또는 터미널에서 실행합니다.

```sh
tccutil reset ScreenCapture im.runners.remote
tccutil reset Accessibility im.runners.remote
```

## 개인정보

Remote 는 우리 회사로 아무것도 모으지 않습니다. 화면은 같은 망에 들어온 컴퓨터끼리만 오갑니다. [PRIVACY.md](PRIVACY.md) 를 보세요.

## 라이선스

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. 코드는 읽어 볼 수 있게 공개했을 뿐이고, 허락 없이 복사 · 수정 · 재배포할 수 없습니다. [LICENSE.md](LICENSE.md) 를 보세요.
