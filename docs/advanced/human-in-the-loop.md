---
sidebar_position: 1
---

# Human-in-the-Loop

사람의 승인이나 입력이 필요한 시점에서 그래프 실행을 중단하고 재개하는 방법을 알아봅니다.

## 개요

Human-in-the-Loop(HITL)은 AI 시스템이 중요한 결정을 내리기 전에 사람의 확인을 받는 패턴입니다.

```
┌────────────────────────────────────────────────────────────┐
│                Human-in-the-Loop Flow                       │
│                                                             │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐    │
│  │  Agent  │──▶│ PAUSE   │──▶│ Human   │──▶│ Resume  │    │
│  │ Decision│   │ (Wait)  │   │ Review  │   │ Execute │    │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘    │
│                     │              │                        │
│                     ▼              ▼                        │
│              ┌──────────┐   ┌──────────┐                   │
│              │ Checkpoint│   │ Approve/ │                   │
│              │   State   │   │ Reject   │                   │
│              └──────────┘   └──────────┘                   │
└────────────────────────────────────────────────────────────┘
```

## 기본 구현

### interrupt_before 사용

특정 노드 실행 전에 중단:

```python
from typing import TypedDict, Annotated, Sequence, Literal
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """이메일을 발송합니다. (민감한 작업)"""
    return f"Email sent to {to}"

@tool
def search(query: str) -> str:
    """정보를 검색합니다. (안전한 작업)"""
    return f"Search results for: {query}"

class State(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

tools = [send_email, search]
llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

def agent(state: State):
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: State) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "end"

graph = StateGraph(State)
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    "end": END
})
graph.add_edge("tools", "agent")

# 중요: tools 노드 실행 전에 중단
memory = MemorySaver()
app = graph.compile(
    checkpointer=memory,
    interrupt_before=["tools"]  # tools 노드 전에 중단
)
```

### 실행 및 재개

```python
config = {"configurable": {"thread_id": "user-123"}}

# 1. 첫 번째 실행 (tools 노드 전에 중단됨)
result = app.invoke(
    {"messages": [HumanMessage(content="john@example.com에게 이메일 보내줘")]},
    config
)

# 2. 현재 상태 확인
state = app.get_state(config)
print("Next node:", state.next)  # ('tools',)
print("Pending tool calls:", state.values["messages"][-1].tool_calls)

# 3. 사람이 검토 후 승인하면 재개
# None을 전달하면 현재 상태에서 계속 실행
result = app.invoke(None, config)
print("Final result:", result["messages"][-1].content)
```

## 승인/거부 처리

### 상태 수정으로 거부

```python
# 도구 호출 거부 시 상태 수정
state = app.get_state(config)

if user_rejects():
    # 도구 호출을 거부 메시지로 대체
    app.update_state(
        config,
        {
            "messages": [
                AIMessage(content="이메일 발송이 사용자에 의해 취소되었습니다.")
            ]
        },
        as_node="tools"  # tools 노드가 실행된 것처럼 처리
    )

# 계속 실행
result = app.invoke(None, config)
```

### 도구 호출 수정

```python
# 도구 호출 파라미터 수정
state = app.get_state(config)
last_message = state.values["messages"][-1]

if last_message.tool_calls:
    # 도구 호출 복사 및 수정
    modified_calls = []
    for call in last_message.tool_calls:
        if call["name"] == "send_email":
            # 수신자 변경
            modified_call = call.copy()
            modified_call["args"]["to"] = "approved@example.com"
            modified_calls.append(modified_call)
        else:
            modified_calls.append(call)

    # 수정된 메시지로 상태 업데이트
    modified_message = AIMessage(
        content=last_message.content,
        tool_calls=modified_calls
    )
    app.update_state(config, {"messages": [modified_message]})

# 수정된 상태로 계속 실행
result = app.invoke(None, config)
```

## 조건부 중단

### 도구 종류에 따른 중단

```python
# 민감한 도구 목록
SENSITIVE_TOOLS = {"send_email", "delete_file", "transfer_money"}

def should_interrupt(state: State) -> bool:
    """민감한 도구 호출 시에만 중단"""
    last_message = state["messages"][-1]

    if not hasattr(last_message, "tool_calls"):
        return False

    for call in last_message.tool_calls:
        if call["name"] in SENSITIVE_TOOLS:
            return True

    return False

# 커스텀 라우팅
def route_tools(state: State) -> str:
    if should_interrupt(state):
        return "human_review"
    return "tools"

graph.add_conditional_edges(
    "agent",
    route_tools,
    {
        "human_review": "human_review",
        "tools": "tools",
        "end": END
    }
)
```

### 금액 기반 중단

```python
APPROVAL_THRESHOLD = 10000  # $10,000 이상은 승인 필요

def needs_approval(state: State) -> bool:
    last_message = state["messages"][-1]

    if not hasattr(last_message, "tool_calls"):
        return False

    for call in last_message.tool_calls:
        if call["name"] == "transfer_money":
            amount = call["args"].get("amount", 0)
            if amount >= APPROVAL_THRESHOLD:
                return True

    return False
```

## FastAPI 통합

### 승인 대기 API

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class ApprovalRequest(BaseModel):
    thread_id: str
    approved: bool
    modified_args: dict = None

@app.post("/chat")
async def chat(message: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}

    result = await agent.ainvoke(
        {"messages": [HumanMessage(content=message)]},
        config
    )

    state = await agent.aget_state(config)

    if state.next:  # 중단된 상태
        return {
            "status": "pending_approval",
            "pending_action": state.values["messages"][-1].tool_calls,
            "thread_id": thread_id
        }

    return {
        "status": "complete",
        "response": result["messages"][-1].content
    }

@app.post("/approve")
async def approve(request: ApprovalRequest):
    config = {"configurable": {"thread_id": request.thread_id}}

    state = await agent.aget_state(config)

    if not state.next:
        raise HTTPException(400, "No pending action")

    if not request.approved:
        # 거부 처리
        await agent.aupdate_state(
            config,
            {"messages": [AIMessage(content="작업이 취소되었습니다.")]},
            as_node="tools"
        )
    elif request.modified_args:
        # 수정된 인자로 업데이트
        last_message = state.values["messages"][-1]
        modified_calls = []
        for call in last_message.tool_calls:
            new_call = call.copy()
            new_call["args"].update(request.modified_args)
            modified_calls.append(new_call)

        await agent.aupdate_state(
            config,
            {"messages": [AIMessage(content="", tool_calls=modified_calls)]}
        )

    # 실행 재개
    result = await agent.ainvoke(None, config)

    return {
        "status": "complete",
        "response": result["messages"][-1].content
    }
```

## 다중 승인

여러 단계의 승인이 필요한 경우:

```python
class MultiApprovalState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    approvals: list[dict]  # 승인 기록
    current_approver: str

def check_approvals(state: MultiApprovalState) -> str:
    """필요한 모든 승인이 완료되었는지 확인"""
    required_approvers = ["manager", "finance"]
    approved_by = [a["approver"] for a in state["approvals"] if a["approved"]]

    for approver in required_approvers:
        if approver not in approved_by:
            return approver  # 다음 승인자

    return "all_approved"

graph.add_node("wait_manager", lambda s: {"current_approver": "manager"})
graph.add_node("wait_finance", lambda s: {"current_approver": "finance"})
graph.add_node("execute", execute_action)

graph.add_conditional_edges(
    "check_approvals",
    check_approvals,
    {
        "manager": "wait_manager",
        "finance": "wait_finance",
        "all_approved": "execute"
    }
)

# 각 승인 대기 노드 전에 중단
app = graph.compile(
    checkpointer=memory,
    interrupt_before=["wait_manager", "wait_finance"]
)
```

## 타임아웃 처리

```python
from datetime import datetime, timedelta
import asyncio

class TimeoutHandler:
    def __init__(self, agent, timeout_hours: int = 24):
        self.agent = agent
        self.timeout = timedelta(hours=timeout_hours)

    async def check_pending_approvals(self):
        """타임아웃된 승인 요청 처리"""
        pending_threads = await self.get_pending_threads()

        for thread_id, created_at in pending_threads:
            if datetime.now() - created_at > self.timeout:
                config = {"configurable": {"thread_id": thread_id}}

                # 타임아웃으로 거부 처리
                await self.agent.aupdate_state(
                    config,
                    {"messages": [AIMessage(content="승인 시간이 초과되었습니다.")]},
                    as_node="tools"
                )
                await self.agent.ainvoke(None, config)

                await self.notify_timeout(thread_id)

    async def get_pending_threads(self):
        # 실제 구현에서는 DB 조회
        pass

    async def notify_timeout(self, thread_id: str):
        # 타임아웃 알림 발송
        pass
```

## 알림 시스템

```python
import aiohttp

class NotificationService:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def notify_pending_approval(
        self,
        thread_id: str,
        action: dict,
        approver: str
    ):
        """승인 요청 알림"""
        payload = {
            "type": "approval_request",
            "thread_id": thread_id,
            "action": action,
            "approver": approver,
            "approval_url": f"https://app.example.com/approve/{thread_id}"
        }

        async with aiohttp.ClientSession() as session:
            await session.post(self.webhook_url, json=payload)

# 중단 시 알림 발송
async def handle_interrupt(state: State, config: dict):
    if state.next:
        await notification_service.notify_pending_approval(
            thread_id=config["configurable"]["thread_id"],
            action=state.values["messages"][-1].tool_calls,
            approver="manager@example.com"
        )
```

## 다음 단계

다음 섹션에서는 서브그래프를 활용하는 방법을 알아봅니다.
