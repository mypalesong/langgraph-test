---
sidebar_position: 1
---

# LangGraph란?

LangGraph는 **LangChain** 팀이 개발한 라이브러리로, LLM을 활용한 **상태 기반(stateful) 멀티 에이전트 워크플로우**를 구축하기 위한 프레임워크입니다.

## 왜 LangGraph인가?

### 기존 LLM 애플리케이션의 한계

기존 LLM 체인 방식은 다음과 같은 한계가 있습니다:

1. **선형적 흐름**: 입력 → 처리 → 출력의 단순한 흐름
2. **상태 관리 어려움**: 대화 맥락이나 중간 결과 유지가 복잡
3. **복잡한 로직 구현 어려움**: 조건 분기, 반복, 에러 핸들링 등

### LangGraph의 해결책

LangGraph는 **그래프 기반 아키텍처**를 통해 이러한 문제를 해결합니다:

```
┌─────────────────────────────────────────────────────────┐
│                     LangGraph                            │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐           │
│  │  Node A │────▶│  Node B │────▶│  Node C │           │
│  └─────────┘     └────┬────┘     └─────────┘           │
│                       │                                  │
│                       ▼                                  │
│                  ┌─────────┐                            │
│                  │  Node D │                            │
│                  └─────────┘                            │
│                                                         │
│  State: { messages: [...], context: {...} }            │
└─────────────────────────────────────────────────────────┘
```

## 핵심 특징

### 1. 순환 그래프 (Cyclic Graph)

LangGraph는 DAG(방향성 비순환 그래프)가 아닌 **순환 그래프**를 지원합니다. 이를 통해:

- 에이전트가 스스로 결정을 내리고 다시 평가할 수 있음
- 반복적인 개선 프로세스 구현 가능
- 복잡한 대화 흐름 처리 가능

```python
# 순환 그래프 예시
graph.add_edge("agent", "tool")
graph.add_conditional_edges(
    "tool",
    should_continue,
    {
        "continue": "agent",  # 다시 agent로 순환
        "end": END
    }
)
```

### 2. 자동 상태 관리

상태가 그래프 전체에서 자동으로 관리됩니다:

```python
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    messages: Annotated[list, add]  # 메시지 자동 누적
    context: dict
```

### 3. 영속성 (Persistence)

체크포인터를 통한 상태 저장 및 복구:

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
app = graph.compile(checkpointer=memory)

# 특정 시점으로 복구 가능
```

### 4. Human-in-the-Loop

사람의 개입이 필요한 시점에서 실행을 중단하고 승인을 받을 수 있습니다:

```python
app = graph.compile(
    checkpointer=memory,
    interrupt_before=["sensitive_action"]
)
```

## LangChain vs LangGraph

| 특성 | LangChain | LangGraph |
|------|-----------|-----------|
| 흐름 | 선형 체인 | 그래프 기반 |
| 순환 | 불가능 | 가능 |
| 상태 관리 | 수동 | 자동 |
| 복잡도 | 단순한 작업에 적합 | 복잡한 워크플로우에 적합 |
| 에이전트 | 단일 에이전트 | 멀티 에이전트 |

## 사용 사례

LangGraph는 다음과 같은 시나리오에 적합합니다:

1. **멀티 에이전트 시스템**: 여러 전문 에이전트가 협력하는 시스템
2. **복잡한 대화형 AI**: 맥락을 유지하며 다양한 분기를 처리
3. **워크플로우 자동화**: 조건에 따른 분기, 반복, 승인 프로세스
4. **RAG 파이프라인**: 검색, 요약, 답변 생성의 복잡한 흐름
5. **코드 에이전트**: 코드 생성, 실행, 디버깅의 반복 프로세스

## 다음 단계

다음 섹션에서 LangGraph를 설치하고 환경을 설정하는 방법을 알아보겠습니다.
