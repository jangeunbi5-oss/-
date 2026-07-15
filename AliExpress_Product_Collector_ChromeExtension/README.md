# AliExpress Product Collector Chrome Extension

FastAPI 없이 Chrome 확장 프로그램만으로 동작하는 프론트엔드 버전입니다.

## 변환된 기능

- 키워드로 AliExpress 검색 탭 열기
- 검색 결과에서 상품 상세 URL 수집
- 상품 상세 HTML을 JavaScript `DOMParser`와 정규식으로 분석
- 상품명, 가격, 통화, 이미지, 상품 ID, 스토어 ID, 브랜드, 평점 등 추출
- 수집 목록을 `chrome.storage.local`에 저장
- 선택 상품 삭제
- CSV, JSON, Excel 호환 `.xls` 파일 다운로드
- 수집 일시정지, 재개, 종료

## FastAPI에서 제거/치환된 부분

- `FastAPI`, `pydantic`, `httpx`, `BeautifulSoup`, `openpyxl`, `Playwright` 의존성을 제거했습니다.
- 서버 파일 저장은 `chrome.storage.local`과 `chrome.downloads`로 대체했습니다.
- `.xlsx` 생성은 브라우저에서 외부 라이브러리 없이 안정적으로 만들기 어렵기 때문에 Excel에서 열 수 있는 `.xls` HTML 파일로 대체했습니다.
- Playwright 브라우저 제어는 Chrome 확장의 `tabs`, `scripting`, `content_scripts`로 대체했습니다.

## 설치 방법

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드`를 누릅니다.
4. `C:\Users\408-00\Desktop\0715\ChromeExtension` 폴더를 선택합니다.

## 파일 구조

```text
ChromeExtension
├─ manifest.json
├─ background.js      # 수집 실행, 상태 관리, 다운로드
├─ content.js         # AliExpress 검색 페이지 링크 수집
├─ parser.js          # FastAPI crawler.py의 상품 파싱 로직 JS 변환
├─ storage.js         # chrome.storage.local 래퍼
├─ exporters.js       # CSV/JSON/Excel 호환 다운로드
├─ popup.html
├─ popup.css
└─ popup.js
```

## 제한 사항

- AliExpress가 CAPTCHA 또는 보안 검증을 띄우면 자동 수집이 제한될 수 있습니다.
- 확장 프로그램은 로컬 파일시스템에 직접 결과 파일을 관리할 수 없으므로, 다운로드 기록은 메타데이터만 보관합니다.
- 기존 백엔드의 실제 `.xlsx` 생성 기능은 `.xls` 다운로드로 대체했습니다.
