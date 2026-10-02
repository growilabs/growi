# GROWI 샌드박스에 오신 것을 환영합니다!

> [!NOTE]
> **샌드박스란 무엇인가요?**
> 
> 자유롭게 편집할 수 있는 연습용 페이지입니다. 새로운 것을 시도하기에 완벽한 장소입니다!


## :beginner: 초보자를 위해

GROWI를 사용하면 "마크다운"이라는 표기법을 사용하여 시각적으로 매력적인 페이지를 쉽게 만들 수 있습니다.
마크다운을 사용하면 다음과 같은 작업을 할 수 있습니다!

- **굵게** 또는 *기울임꼴*로 텍스트 강조
- 글머리 기호 또는 번호 매기기 목록 만들기
- [링크 삽입](#-link)
- 표 만들기
- 코드 블록 추가

다양한 다른 꾸미기도 가능합니다.

## 시도해 보세요!

1. 이 페이지를 자유롭게 편집하세요
1. 실수하는 것을 두려워할 필요가 없습니다
1. 언제든지 변경 사항을 되돌릴 수 있습니다
1. 다른 사람의 편집 내용에서 배울 수도 있습니다

> [!IMPORTANT]
> **관리자를 위해**
> 
> 샌드박스는 학습을 위한 중요한 장소입니다:
> - 새로운 구성원이 GROWI에 익숙해지기 위한 첫 단계
> - 마크다운 연습장
> - 팀 내 커뮤니케이션 도구
>     - 이 페이지가 어수선해지더라도 활발한 학습의 신호입니다. 정기적인 정리는 좋지만, 자유로운 실험 공간으로서의 성격을 유지하는 것이 좋습니다.


# :closed_book: 제목 및 단락
- 제목과 단락을 삽입하여 페이지의 텍스트를 읽기 쉽게 만들 수 있습니다.

## 제목
- 제목 텍스트 앞에 `#`를 추가하여 제목을 만듭니다.
    - `#`의 수에 따라 보기 화면에 표시되는 제목의 글꼴 크기가 달라집니다.
- `#`의 수는 계층 수준을 결정하고 콘텐츠를 구성하는 데 도움이 됩니다.

```markdown
# 첫 번째 수준 제목
## 두 번째 수준 제목
### 세 번째 수준 제목
#### 네 번째 수준 제목
##### 다섯 번째 수준 제목
###### 여섯 번째 수준 제목
```

## 줄 바꿈
- 줄을 바꾸고 싶은 문장 끝에 반각 공백 두 개를 삽입합니다.
    - 설정에서 반각 공백 없이 줄을 바꾸도록 변경할 수도 있습니다.
        - 관리자 페이지의 `마크다운 설정` 섹션에서 줄 바꿈 설정을 변경하세요.

#### 예시: 줄 바꿈 없음
단락 1
단락 2

#### 예시: 줄 바꿈 있음
단락 1  
단락 2

## 블록
- 텍스트에 빈 줄을 삽입하여 단락을 만들 수 있습니다.
- 구절을 문장으로 나누어 읽기 쉽게 만들 수 있습니다.

#### 예시: 단락 없음
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

#### 예시: 단락 있음
Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.


# :blue_book: 텍스트 스타일링

- 문장의 텍스트 표현을 풍부하게 하기 위해 다양한 스타일을 적용할 수 있습니다.
    - 이러한 스타일은 편집 화면 하단의 도구 모음 아이콘을 선택하여 쉽게 적용할 수도 있습니다.

| 스타일                     | 구문                   | 바로 가기 키 | 예시                                      | 출력                                   |
| -------------------------- | ---------------------- | ------------ | ----------------------------------------- | -------------------------------------- |
| 굵게                       | `** **` 또는 `__ __`   | (미정)       | `**이것은 굵은 텍스트입니다**`            | **이것은 굵은 텍스트입니다**           |
| 기울임꼴                   | `* *` 또는 `_ _`       | (미정)       | `_이 텍스트는 기울임꼴입니다_`            | *이 텍스트는 기울임꼴입니다*           |
| 취소선                     | `~~ ~~`                | (미정)       | `~~이것은 잘못된 텍스트였습니다~~`        | ~~이것은 잘못된 텍스트였습니다~~       |
| 굵게 및 중첩 기울임꼴      | `** **` 및 `_ _`       | 없음         | `**이 텍스트는 _매우_ 중요합니다**`       | **이 텍스트는 _매우_ 중요합니다**      |
| 모두 굵게 및 기울임꼴      | `*** ***`              | 없음         | `***이 모든 텍스트는 중요합니다***`       | ***이 모든 텍스트는 중요합니다***      |
| 아래 첨자                  | `<sub> </sub>`         | 없음         | `이것은 <sub>아래 첨자</sub> 텍스트입니다`  | 이것은 <sub>아래 첨자</sub> 텍스트입니다 |
| 위 첨자                    | `<sup> </sup>`         | 없음         | `이것은 <sup>위 첨자</sup> 텍스트입니다`    | 이것은 <sup>위 첨자</sup> 텍스트입니다   |


# :green_book: 목록 삽입
## 글머리 기호 목록
- 하이픈 `-`, 더하기 `+` 또는 별표 `*`로 줄을 시작하여 글머리 기호 목록을 삽입합니다.

#### 예시
- 이 문장은 글머리 기호 목록에 있습니다.
    - 이 문장은 글머리 기호 목록에 있습니다.
        - 이 문장은 글머리 기호 목록에 있습니다.
        - 이 문장은 글머리 기호 목록에 있습니다.
- 이 문장은 글머리 기호 목록에 있습니다.
    - 이 문장은 글머리 기호 목록에 있습니다.

## 번호 매기기 목록
- `숫자.`를 줄 시작 부분에 사용하여 번호 매기기 목록을 삽입합니다.
    - 번호는 자동으로 할당됩니다.

- 번호 매기기 목록과 글머리 기호 목록을 조합하여 사용할 수도 있습니다.

#### 예시
1. 이 문장은 번호 매기기 목록에 있습니다.
    1. 이 문장은 번호 매기기 목록에 있습니다.
    1. 이 문장은 번호 매기기 목록에 있습니다.
    1. 이 문장은 번호 매기기 목록에 있습니다.
        - 이 문장은 글머리 기호 목록에 있습니다.
1. 이 문장은 글머리 기호 목록에 있습니다.
    - 이 문장은 글머리 기호 목록에 있습니다.


# :ledger: 링크

## 자동 링크
URL을 그냥 쓰면 링크가 자동으로 생성됩니다.

### 예시

https://www.google.co.jp

```markdown
https://www.google.co.jp
```

## 레이블 및 링크
`[레이블](URL)`을 작성하여 링크를 삽입합니다.

### 예시
- [Google](https://www.google.co.jp/)
- [샌드박스는 여기에 있습니다](/Sandbox)

```markdown
- [Google](https://www.google.co.jp/)
- [샌드박스는 여기에 있습니다](/Sandbox)
```

## 유연한 링크 구문

유연한 링크 구문을 사용하면 페이지 경로, 상대 페이지 링크 및 링크 레이블과 URL로 링크를 쉽게 작성할 수 있습니다.

- [[/Sandbox]]
- [[./Math]]
- [[수식 작성 방법?>./Math]]

```markdown
- [[/Sandbox]]
- [[./Math]]
- [[수식 작성 방법?>./Math]]
```


# :notebook: 더 많은 응용 프로그램

- [마크다운에 대해 더 알아보기](/Sandbox/Markdown)

- [페이지를 더 꾸미기 (Bootstrap5)](/Sandbox/Bootstrap5)

- [다이어그램 표현 방법 (Diagrams)](/Sandbox/Diagrams)

- [수학 공식 표현 방법 (Math)](/Sandbox/Math)