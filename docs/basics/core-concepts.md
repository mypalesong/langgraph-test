---
sidebar_position: 3
---

# 핵심 개념

LangGraph의 세 가지 핵심 개념인 **State**, **Node**, **Edge**를 상세히 알아봅니다.

## State (상태)

State는 그래프 전체에서 공유되는 데이터 구조입니다. 모든 노드는 이 상태를 읽고 수정할 수 있습니다.

### 기본 상태 정의

```python
from typing import TypedDict

class State(TypedDict):
    messages: list[str]
    user_input: str
    response: str
```

### Annotated를 사용한 상태 리듀서

여러 노드가 같은 키를 업데이트할 때 **리듀서(reducer)**를 사용하여 값을 합칠 수 있습니다:

```python
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    # add 리듀서: 리스트를 합침
    messages: Annotated[list[str], add]

    # 커스텀 리듀서
    count: Annotated[int, lambda old, new: old + new]
```

### 리듀서 동작 예시

```python
# add 리듀서 사용 시
# 노드 A가 {"messages": ["Hello"]} 반환
# 노드 B가 {"messages": ["World"]} 반환
# 최종 상태: {"messages": ["Hello", "World"]}

# 리듀서 없이
# 노드 A가 {"messages": ["Hello"]} 반환
# 노드 B가 {"messages": ["World"]} 반환
# 최종 상태: {"messages": ["World"]}  # 덮어씌워짐
```

### 복잡한 상태 예시

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    # LangChain 메시지 누적 (내장 리듀서)
    messages: Annotated[Sequence[BaseMessage], add_messages]

    # 현재 단계
    current_step: str

    # 도구 실행 결과
    tool_results: list[dict]

    # 최종 응답
    final_response: str | None
```

## Node (노드)

노드는 그래프에서 실제 작업을 수행하는 함수입니다. 상태를 입력받아 업데이트된 상태(또는 일부)를 반환합니다.

### 기본 노드 정의

```python
def my_node(state: State) -> dict:
    """노드 함수: 상태를 받아 업데이트할 부분만 반환"""
    current_messages = state["messages"]
    new_message = "Processed!"

    return {
        "messages": [new_message]  # 리듀서로 합쳐짐
    }
```

### 그래프에 노드 추가

```python
from langgraph.graph import StateGraph

graph = StateGraph(State)

# 함수를 노드로 추가
graph.add_node("process", my_node)

# 람다 함수도 가능
graph.add_node("greet", lambda state: {"messages": ["Hello!"]})
```

### LLM을 사용하는 노드

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4")

def chat_node(state: State) -> dict:
    """LLM을 호출하는 노드"""
    messages = state["messages"]
    response = llm.invoke(messages)

    return {
        "messages": [response]
    }

graph.add_node("chat", chat_node)
```

### 도구를 사용하는 노드

```python
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """웹 검색을 수행합니다."""
    # 실제 검색 로직
    return f"Search results for: {query}"

def tool_node(state: State) -> dict:
    """도구를 실행하는 노드"""
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls"):
        results = []
        for tool_call in last_message.tool_calls:
            result = search.invoke(tool_call["args"])
            results.append(result)

        return {"tool_results": results}

    return {}
```

## Edge (엣지)

엣지는 노드 간의 연결을 정의합니다. 실행 흐름을 결정합니다.

### 기본 엣지

```python
from langgraph.graph import END

# 노드 A에서 노드 B로 이동
graph.add_edge("node_a", "node_b")

# 노드 B에서 종료
graph.add_edge("node_b", END)
```

### 시작점 설정

```python
# 그래프의 시작 노드 지정
graph.set_entry_point("first_node")

# 또는 START 상수 사용
from langgraph.graph import START
graph.add_edge(START, "first_node")
```

### 조건부 엣지

상태에 따라 다른 노드로 분기:

```python
def should_continue(state: State) -> str:
    """다음 노드를 결정하는 함수"""
    messages = state["messages"]
    last_message = messages[-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"

# 조건부 엣지 추가
graph.add_conditional_edges(
    "agent",          # 출발 노드
    should_continue,  # 조건 함수
    {
        "tools": "tool_node",  # "tools" 반환 시
        "end": END            # "end" 반환 시
    }
)
```

### 복잡한 조건 분기

```python
def route_by_intent(state: State) -> str:
    """사용자 의도에 따라 라우팅"""
    intent = state.get("intent", "unknown")

    routing = {
        "question": "qa_agent",
        "task": "task_agent",
        "chat": "chat_agent",
        "unknown": "classifier"
    }

    return routing.get(intent, "classifier")

graph.add_conditional_edges(
    "router",
    route_by_intent,
    {
        "qa_agent": "qa_agent",
        "task_agent": "task_agent",
        "chat_agent": "chat_agent",
        "classifier": "intent_classifier"
    }
)
```

## 전체 흐름 예시

```python
from typing import TypedDict, Annotated
from operator import add
from langgraph.graph import StateGraph, END, START

# 1. 상태 정의
class State(TypedDict):
    messages: Annotated[list[str], add]
    step: int

# 2. 노드 정의
def step_one(state: State) -> dict:
    return {
        "messages": ["Step 1 completed"],
        "step": 1
    }

def step_two(state: State) -> dict:
    return {
        "messages": ["Step 2 completed"],
        "step": 2
    }

def should_continue(state: State) -> str:
    if state["step"] < 2:
        return "continue"
    return "end"

# 3. 그래프 구성
graph = StateGraph(State)

graph.add_node("step_one", step_one)
graph.add_node("step_two", step_two)

graph.add_edge(START, "step_one")
graph.add_conditional_edges(
    "step_one",
    should_continue,
    {
        "continue": "step_two",
        "end": END
    }
)
graph.add_edge("step_two", END)

# 4. 컴파일 및 실행
app = graph.compile()
result = app.invoke({"messages": [], "step": 0})

print(result)
# {'messages': ['Step 1 completed', 'Step 2 completed'], 'step': 2}
```

## 그래프 시각화

```python
# Mermaid 다이어그램 생성
print(app.get_graph().draw_mermaid())

# PNG 이미지로 저장 (graphviz 필요)
from IPython.display import Image
Image(app.get_graph().draw_mermaid_png())
```

## 다음 단계

핵심 개념을 이해했으니, 다음 섹션에서 실제로 첫 번째 그래프를 만들어봅니다.
