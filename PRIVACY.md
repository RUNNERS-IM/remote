# Remote Privacy Policy

Last updated: November 1, 2026

Remote is an app made by Runners Co., Ltd for seeing and clicking the screens of other computers. This policy covers every version of Remote.

## What Remote collects

Nothing. Remote has no account, no ads and no analytics, and it does not send anything about you or your computer to Runners or anyone else, except what the office connection below needs to work.

## What Remote reads on your computer

When the Remote window is open, Remote takes pictures of the display you choose, about five a second, to show them in that window. The pictures stay in memory only: they are not saved to disk and not sent anywhere, and Remote stops taking them when the window closes.

Remote also reads the list of displays and whether it has the Screen Recording and Accessibility permissions.

When you turn on **Send Clicks** in the window, a click on the picture is sent to the same spot on your own screen. Remote does nothing else with your mouse or keyboard.

## Network

Remote connects to the internet for two things: updates, and the office connection below. A minute after it starts and once a day after that, it reads
the list of releases and the update file (`latest-mac.yml`, `latest.yml` or `latest-linux.yml`) from Remote's GitHub
release page to see whether there is a newer version; if there is, it downloads it, then asks you, and only installs it
when you choose Install Now. Choosing Later means it does not ask again that day. The requests carry nothing about you
or your computer; like any download, GitHub sees the computer's IP address. Turning off **Check for Updates
Automatically** stops the daily check. Choosing **Check for Updates…** does the same check right away. Choosing
**Help & Feedback** opens the issue page below in your web browser.

### Office connection

When a coordination server is set, Remote starts `remote-link`, which joins a private network run by the organization
that set the server (for Runners, our own Headscale server). Joining sends the server this computer's name, its
operating system and its network addresses, the same as Tailscale does; the server uses them only to tell the
computers in that network how to reach each other. Screens, clicks and keys never go through it: they go directly
between the two computers, encrypted (WireGuard), or through an encrypted relay when a direct path is not possible.

- Another computer in the network sees this one only while **Let Other Computers See This** is on, and can click and
  type only while **Let Other Computers Click and Type** is also on. **Disconnect Now** turns seeing off at once.
- Remote listens only on the private network address, so computers outside that network cannot reach it.
- The connection log (who viewed, clicked or typed, and when; never the text typed) stays in memory on this computer
  and is gone when Remote quits.
- Pictures sent to another computer are not saved on either computer.

### Claude

When you add Remote's MCP server to Claude, Claude can list the computers, see their screens and, with the approval
described in the README, click and type. Screenshots Claude takes go to Claude like anything else you share with it,
under Anthropic's terms; Remote itself sends nothing to Anthropic or Runners.

## Contact

Questions: open an issue at https://github.com/RUNNERS-IM/remote/issues.

---

# Remote 개인정보 처리방침

최종 수정: 2026년 11월 1일

Remote 는 Runners Co., Ltd 가 만드는, 다른 컴퓨터 화면을 보고 누르는 앱입니다. 이 방침은 모든 Remote 에 적용됩니다.

## 모으는 정보

없습니다. Remote 에는 계정, 광고, 사용 통계 수집이 없고, 사용자나 컴퓨터에 관한 어떤 정보도 Runners 나 다른 곳으로 보내지 않습니다. 아래 사무실 연결이 동작하는 데 필요한 것만 예외입니다.

## 컴퓨터 안에서 읽는 정보

Remote 창이 열려 있으면, 고른 모니터의 화면을 초당 5장쯤 찍어 그 창에 보여 줍니다. 찍은 화면은 메모리에만 있고 디스크에 저장하거나 어디로 보내지 않으며, 창을 닫으면 찍기를 멈춥니다.

모니터 목록과, 화면 기록 · 손쉬운 사용 권한이 켜졌는지도 읽습니다.

창에서 **클릭 보내기** 를 켜면, 화면 그림을 누른 자리를 이 컴퓨터 화면의 같은 자리에 클릭합니다. 그 밖에는 마우스나 키보드에 아무것도 하지 않습니다.

## 인터넷 연결

Remote 가 인터넷에 접속하는 일은 업데이트와 아래 사무실 연결 두 가지입니다. 켜진 지 1분 뒤와 그 뒤 하루에 한 번 Remote 의 GitHub
릴리스 페이지에서 릴리스 목록과 업데이트 파일(`latest-mac.yml`, `latest.yml`, `latest-linux.yml`)을 받아 새 버전이
있는지 보고, 있으면 먼저 받아 둔 뒤 물어보고 **지금 설치** 를 고를 때만 설치합니다. **나중에** 를 고르면 그날은 다시
묻지 않습니다. 이 요청에는 사용자나 컴퓨터에 관한 정보가 들어가지 않습니다. 다만 다른 내려받기와 마찬가지로 GitHub 는
컴퓨터의 IP 주소를 봅니다. **업데이트 자동 확인** 을 끄면 하루 한 번 확인을 멈춥니다. **업데이트 확인…** 을 고르면 같은
확인을 바로 합니다. **도움말 · 피드백** 을 고르면 아래 이슈 페이지가 웹 브라우저에서 열립니다.

### 사무실 연결

연결 서버가 정해져 있으면 Remote 는 `remote-link` 를 켜고, 그 서버를 정한 조직이 운영하는 전용 망(러너스는 우리
Headscale 서버)에 들어갑니다. 들어갈 때 이 컴퓨터의 이름, 운영체제, 네트워크 주소를 서버에 보냅니다(Tailscale 과
같습니다). 서버는 이것을 같은 망의 컴퓨터끼리 서로 찾아가는 길을 알려 주는 데만 씁니다. 화면 · 클릭 · 키는 서버를
거치지 않고 두 컴퓨터 사이를 암호화(WireGuard)해 바로 오가며, 바로 갈 길이 없을 때만 암호화된 중계 서버를 거칩니다.

- 같은 망의 다른 컴퓨터는 **다른 컴퓨터에 이 화면 보이기** 가 켜져 있을 때만 이 컴퓨터를 보고, **다른 컴퓨터의 클릭 ·
  키 입력 허용** 까지 켜져 있을 때만 클릭 · 입력합니다. **지금 끊기** 는 보기를 바로 끕니다.
- Remote 는 전용 망 주소에서만 연결을 받으므로, 그 망 밖의 컴퓨터는 닿을 수 없습니다.
- 접속 기록(누가 언제 보거나 클릭 · 입력했는지. 친 글자 내용은 적지 않습니다)은 이 컴퓨터 메모리에만 있고 Remote 를
  끄면 사라집니다.
- 다른 컴퓨터로 보낸 화면은 어느 쪽 컴퓨터에도 저장하지 않습니다.

### Claude

Remote 의 MCP 서버를 Claude 에 붙이면, Claude 는 컴퓨터 목록과 화면을 보고, README 에 적은 승인을 거쳐 클릭 · 입력할
수 있습니다. Claude 가 찍은 화면은 Claude 에 보여 주는 다른 것과 똑같이 Anthropic 약관에 따라 Claude 로 갑니다.
Remote 자체는 Anthropic 이나 Runners 로 아무것도 보내지 않습니다.

## 문의

https://github.com/RUNNERS-IM/remote/issues 에 글을 남겨 주세요.
