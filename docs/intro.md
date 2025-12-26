---
sidebar_position: 1
slug: /
---

# LangGraph 가이드

LangGraph는 LLM(대규모 언어 모델)을 활용한 **상태 기반 멀티 에이전트 애플리케이션**을 구축하기 위한 프레임워크입니다.

## 이 가이드에서 다루는 내용

이 문서는 LangGraph를 처음 접하는 개발자부터 프로덕션 환경에서 활용하려는 개발자까지 모두를 위한 종합 가이드입니다.

### 1. 기본 개념
- LangGraph란 무엇인가
- 설치 및 환경 설정
- 핵심 개념 (State, Node, Edge)
- 첫 번째 그래프 만들기

### 2. 외부 데이터 연동
- 데이터베이스 연동 (PostgreSQL, MongoDB)
- REST API 통합
- Vector Store 연동 (검색 증강 생성)

### 3. 백엔드 구축
- 아키텍처 설계
- FastAPI와 통합
- 상태 영속성 관리
- 실시간 스트리밍

### 4. 고급 기능
- Human-in-the-Loop
- 서브그래프 활용
- 체크포인팅

## 시작하기 전에

다음 사전 지식이 있으면 이 가이드를 더 효과적으로 학습할 수 있습니다:

- Python 기본 문법
- 비동기 프로그래밍 개념 (`async`/`await`)
- LLM 기본 개념
- REST API 기본 이해

## 빠른 시작

```bash
# LangGraph 설치
pip install langgraph langchain-openai

# 환경 변수 설정
export OPENAI_API_KEY="your-api-key"
```

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict

# 상태 정의
class State(TypedDict):
    messages: list[str]

# 그래프 생성
graph = StateGraph(State)

# 노드 추가
def chat_node(state: State) -> State:
    return {"messages": state["messages"] + ["Hello!"]}

graph.add_node("chat", chat_node)
graph.set_entry_point("chat")
graph.add_edge("chat", END)

# 그래프 컴파일 및 실행
app = graph.compile()
result = app.invoke({"messages": []})
print(result)
```

다음 섹션에서 각 개념을 자세히 살펴보겠습니다.
