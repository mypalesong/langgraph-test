---
sidebar_position: 4
---

# 첫 번째 그래프 만들기

실제로 동작하는 LangGraph 애플리케이션을 만들어봅니다. 간단한 챗봇부터 도구를 사용하는 ReAct 에이전트까지 구현합니다.

## 1. 간단한 챗봇

가장 기본적인 LangGraph 챗봇입니다.

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages

# 상태 정의
class ChatState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

# LLM 초기화
llm = ChatOpenAI(model="gpt-4o-mini")

# 챗봇 노드
def chatbot(state: ChatState) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

# 그래프 구성
graph = StateGraph(ChatState)
graph.add_node("chatbot", chatbot)
graph.add_edge(START, "chatbot")
graph.add_edge("chatbot", END)

# 컴파일
app = graph.compile()

# 실행
result = app.invoke({
    "messages": [HumanMessage(content="안녕하세요! 파이썬에 대해 알려주세요.")]
})

print(result["messages"][-1].content)
```

## 2. 도구를 사용하는 에이전트

검색 도구를 사용하는 ReAct 패턴 에이전트입니다.

```python
from typing import TypedDict, Annotated, Sequence, Literal
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

# 도구 정의
@tool
def search(query: str) -> str:
    """웹에서 정보를 검색합니다."""
    # 실제로는 검색 API 호출
    return f"'{query}'에 대한 검색 결과: 관련 정보가 발견되었습니다."

@tool
def calculator(expression: str) -> str:
    """수학 계산을 수행합니다."""
    try:
        result = eval(expression)
        return f"계산 결과: {result}"
    except Exception as e:
        return f"계산 오류: {e}"

tools = [search, calculator]

# 상태 정의
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

# 도구가 바인딩된 LLM
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

# 에이전트 노드
def agent(state: AgentState) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

# 조건 함수
def should_continue(state: AgentState) -> Literal["tools", "end"]:
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "end"

# 그래프 구성
graph = StateGraph(AgentState)

# 노드 추가
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

# 엣지 연결
graph.add_edge(START, "agent")
graph.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        "end": END
    }
)
graph.add_edge("tools", "agent")  # 도구 실행 후 다시 에이전트로

# 컴파일
app = graph.compile()

# 실행
result = app.invoke({
    "messages": [HumanMessage(content="파이썬의 창시자를 검색하고, 2+2를 계산해주세요.")]
})

for msg in result["messages"]:
    print(f"{msg.type}: {msg.content[:100]}...")
```

## 3. 스트리밍 출력

실시간으로 응답을 스트리밍합니다.

```python
# 토큰 단위 스트리밍
for chunk in app.stream(
    {"messages": [HumanMessage(content="파이썬의 장점 5가지를 알려주세요.")]},
    stream_mode="values"
):
    if chunk["messages"]:
        last_msg = chunk["messages"][-1]
        if hasattr(last_msg, "content"):
            print(last_msg.content)

# 이벤트 단위 스트리밍
for event in app.stream(
    {"messages": [HumanMessage(content="검색해주세요")]},
    stream_mode="updates"
):
    for node_name, output in event.items():
        print(f"Node: {node_name}")
        print(f"Output: {output}")
```

## 4. 대화 기록 유지

메모리를 사용하여 대화 기록을 유지합니다.

```python
from langgraph.checkpoint.memory import MemorySaver

# 체크포인터 생성
memory = MemorySaver()

# 체크포인터와 함께 컴파일
app = graph.compile(checkpointer=memory)

# 스레드 ID로 대화 구분
config = {"configurable": {"thread_id": "user-123"}}

# 첫 번째 메시지
result1 = app.invoke(
    {"messages": [HumanMessage(content="제 이름은 김철수입니다.")]},
    config=config
)
print(result1["messages"][-1].content)

# 두 번째 메시지 (이전 대화 기억)
result2 = app.invoke(
    {"messages": [HumanMessage(content="제 이름이 뭐라고 했죠?")]},
    config=config
)
print(result2["messages"][-1].content)  # "김철수"를 기억함
```

## 5. 그래프 시각화

그래프 구조를 시각화합니다.

```python
# Mermaid 다이어그램
mermaid_code = app.get_graph().draw_mermaid()
print(mermaid_code)

# 출력 예시:
# %%{init: {'flowchart': {'curve': 'linear'}}}%%
# graph TD;
#     __start__([<p>__start__</p>]):::first
#     agent(agent)
#     tools(tools)
#     __end__([<p>__end__</p>]):::last
#     __start__ --> agent;
#     tools --> agent;
#     agent -. tools .-> tools;
#     agent -. end .-> __end__;
```

## 6. 비동기 실행

비동기 환경에서 실행합니다.

```python
import asyncio

async def main():
    # 비동기 실행
    result = await app.ainvoke({
        "messages": [HumanMessage(content="비동기로 실행됩니다!")]
    })
    print(result["messages"][-1].content)

    # 비동기 스트리밍
    async for chunk in app.astream(
        {"messages": [HumanMessage(content="스트리밍!")]}
    ):
        print(chunk)

asyncio.run(main())
```

## 완성된 예제 코드

아래는 모든 기능을 포함한 완성된 예제입니다:

```python
# complete_agent.py
from typing import TypedDict, Annotated, Sequence, Literal
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver


@tool
def search(query: str) -> str:
    """웹 검색을 수행합니다."""
    return f"검색 결과: {query}에 대한 정보"


@tool
def calculator(expression: str) -> str:
    """수학 계산을 수행합니다."""
    return str(eval(expression))


class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]


def create_agent():
    tools = [search, calculator]
    llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

    def agent_node(state: AgentState) -> dict:
        return {"messages": [llm.invoke(state["messages"])]}

    def should_continue(state: AgentState) -> Literal["tools", "end"]:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return "end"

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {
        "tools": "tools",
        "end": END
    })
    graph.add_edge("tools", "agent")

    return graph.compile(checkpointer=MemorySaver())


if __name__ == "__main__":
    app = create_agent()

    config = {"configurable": {"thread_id": "demo"}}

    while True:
        user_input = input("You: ")
        if user_input.lower() in ["quit", "exit"]:
            break

        result = app.invoke(
            {"messages": [HumanMessage(content=user_input)]},
            config=config
        )
        print(f"AI: {result['messages'][-1].content}")
```

## 다음 단계

기본적인 그래프 구현을 마쳤습니다. 다음 섹션에서는 외부 데이터를 연동하는 방법을 알아봅니다.
