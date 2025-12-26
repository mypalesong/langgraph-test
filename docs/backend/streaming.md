---
sidebar_position: 4
---

# 실시간 스트리밍

LangGraph에서 실시간으로 응답을 스트리밍하는 다양한 방법을 알아봅니다.

## 스트리밍 모드

LangGraph는 여러 스트리밍 모드를 지원합니다:

| 모드 | 설명 | 사용 사례 |
|------|------|----------|
| `values` | 각 단계 후 전체 상태 | 상태 변화 추적 |
| `updates` | 노드 출력만 | 노드별 결과 확인 |
| `messages` | 메시지 토큰 스트림 | 채팅 UI |
| `events` | 모든 이벤트 상세 | 디버깅, 상세 로깅 |

## 기본 스트리밍

### values 모드

각 노드 실행 후 전체 상태를 반환:

```python
from langgraph.graph import StateGraph, END, START
from langchain_core.messages import HumanMessage

# 그래프 실행 및 스트리밍
for state in app.stream(
    {"messages": [HumanMessage(content="안녕하세요")]},
    stream_mode="values"
):
    print("Current state:", state)
    if state.get("messages"):
        print("Last message:", state["messages"][-1].content)
```

### updates 모드

각 노드가 반환한 업데이트만 반환:

```python
for update in app.stream(
    {"messages": [HumanMessage(content="안녕하세요")]},
    stream_mode="updates"
):
    for node_name, node_output in update.items():
        print(f"Node '{node_name}' output:", node_output)
```

### messages 모드

LLM 토큰을 실시간으로 스트리밍:

```python
for chunk in app.stream(
    {"messages": [HumanMessage(content="긴 설명을 해주세요")]},
    stream_mode="messages"
):
    # chunk는 (message, metadata) 튜플
    message, metadata = chunk
    if hasattr(message, "content") and message.content:
        print(message.content, end="", flush=True)
```

## 비동기 스트리밍

### astream

```python
async def stream_response():
    async for state in app.astream(
        {"messages": [HumanMessage(content="안녕하세요")]},
        stream_mode="values"
    ):
        yield state
```

### astream_events

상세한 이벤트 스트리밍:

```python
async def stream_events():
    async for event in app.astream_events(
        {"messages": [HumanMessage(content="안녕하세요")]},
        version="v2"
    ):
        kind = event["event"]
        name = event.get("name", "")

        if kind == "on_chain_start":
            print(f"Chain started: {name}")

        elif kind == "on_chat_model_start":
            print(f"LLM started: {name}")

        elif kind == "on_chat_model_stream":
            content = event["data"]["chunk"].content
            if content:
                print(content, end="", flush=True)

        elif kind == "on_tool_start":
            print(f"\nTool started: {name}")

        elif kind == "on_tool_end":
            print(f"Tool result: {event['data']['output']}")

        elif kind == "on_chain_end":
            print(f"\nChain ended: {name}")
```

## FastAPI SSE 구현

### 기본 SSE

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
import json

app = FastAPI()

@app.post("/stream")
async def stream_chat(message: str, thread_id: str = "default"):
    config = {"configurable": {"thread_id": thread_id}}

    async def event_generator():
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=message)]},
            config=config,
            version="v2"
        ):
            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    data = json.dumps({"type": "token", "content": content})
                    yield f"data: {data}\n\n"

            elif event["event"] == "on_tool_start":
                data = json.dumps({
                    "type": "tool_start",
                    "name": event["name"]
                })
                yield f"data: {data}\n\n"

            elif event["event"] == "on_tool_end":
                data = json.dumps({
                    "type": "tool_end",
                    "result": str(event["data"]["output"])
                })
                yield f"data: {data}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Nginx 버퍼링 비활성화
        }
    )
```

### 클라이언트 구현

```javascript
// JavaScript 클라이언트
async function streamChat(message) {
    const response = await fetch('/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'token') {
                    // 토큰 출력
                    appendToChat(data.content);
                } else if (data.type === 'tool_start') {
                    showToolIndicator(data.name);
                } else if (data.type === 'done') {
                    finishChat();
                }
            }
        }
    }
}
```

## WebSocket 스트리밍

### 서버 구현

```python
from fastapi import WebSocket, WebSocketDisconnect
import json

@app.websocket("/ws/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()

    try:
        while True:
            # 메시지 수신
            data = await websocket.receive_text()
            message_data = json.loads(data)

            config = {"configurable": {"thread_id": session_id}}

            # 스트리밍 응답
            async for event in agent.astream_events(
                {"messages": [HumanMessage(content=message_data["message"])]},
                config=config,
                version="v2"
            ):
                if event["event"] == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        await websocket.send_json({
                            "type": "token",
                            "content": content
                        })

                elif event["event"] == "on_tool_start":
                    await websocket.send_json({
                        "type": "tool_start",
                        "name": event["name"]
                    })

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        print(f"Client {session_id} disconnected")
```

### WebSocket 클라이언트

```javascript
// JavaScript WebSocket 클라이언트
class ChatClient {
    constructor(sessionId) {
        this.ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);
        this.setupListeners();
    }

    setupListeners() {
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'token':
                    this.onToken(data.content);
                    break;
                case 'tool_start':
                    this.onToolStart(data.name);
                    break;
                case 'done':
                    this.onComplete();
                    break;
            }
        };
    }

    send(message) {
        this.ws.send(JSON.stringify({ message }));
    }

    onToken(content) {
        document.getElementById('chat').innerText += content;
    }

    onToolStart(name) {
        console.log(`Using tool: ${name}`);
    }

    onComplete() {
        console.log('Response complete');
    }
}
```

## 스트리밍 중단

### 취소 토큰

```python
from asyncio import CancelledError

@app.post("/stream")
async def stream_with_cancel(message: str, request: Request):
    config = {"configurable": {"thread_id": "user-123"}}

    async def event_generator():
        try:
            async for event in agent.astream_events(
                {"messages": [HumanMessage(content=message)]},
                config=config,
                version="v2"
            ):
                # 클라이언트 연결 확인
                if await request.is_disconnected():
                    print("Client disconnected, stopping stream")
                    break

                if event["event"] == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield f"data: {json.dumps({'content': content})}\n\n"

        except CancelledError:
            print("Stream cancelled")
            raise

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

## 멀티플렉싱

여러 그래프 실행을 하나의 스트림으로:

```python
import asyncio

async def multiplex_streams(queries: list[str]):
    """여러 쿼리를 병렬로 스트리밍"""

    async def stream_one(query: str, index: int):
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=query)]},
            version="v2"
        ):
            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    yield {"index": index, "content": content}

    # 모든 스트림 병합
    async def merged_generator():
        tasks = [stream_one(q, i) for i, q in enumerate(queries)]
        streams = [task.__aiter__() for task in tasks]

        while streams:
            done_streams = []
            for i, stream in enumerate(streams):
                try:
                    item = await asyncio.wait_for(
                        stream.__anext__(),
                        timeout=0.1
                    )
                    yield item
                except StopAsyncIteration:
                    done_streams.append(i)
                except asyncio.TimeoutError:
                    continue

            for i in reversed(done_streams):
                streams.pop(i)

    return merged_generator()
```

## 스트리밍 최적화

### 버퍼링

```python
class BufferedStreamer:
    def __init__(self, buffer_size: int = 10, flush_interval: float = 0.1):
        self.buffer = []
        self.buffer_size = buffer_size
        self.flush_interval = flush_interval
        self.last_flush = time.time()

    async def stream(self, agent, input_data, config):
        async for event in agent.astream_events(input_data, config, version="v2"):
            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    self.buffer.append(content)

                    # 버퍼가 가득 찼거나 시간 초과
                    if len(self.buffer) >= self.buffer_size or \
                       time.time() - self.last_flush > self.flush_interval:
                        yield "".join(self.buffer)
                        self.buffer = []
                        self.last_flush = time.time()

        # 남은 버퍼 플러시
        if self.buffer:
            yield "".join(self.buffer)
```

### 압축

```python
import gzip
from fastapi.responses import Response

@app.post("/stream/compressed")
async def compressed_stream(message: str):
    async def generate():
        buffer = []
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=message)]},
            version="v2"
        ):
            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    buffer.append(content)

        full_response = "".join(buffer)
        compressed = gzip.compress(full_response.encode())
        return compressed

    data = await generate()
    return Response(
        content=data,
        media_type="application/gzip",
        headers={"Content-Encoding": "gzip"}
    )
```

## 완전한 스트리밍 서버 예제

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver
import json

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 그래프 설정
class State(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

llm = ChatOpenAI(model="gpt-4o-mini", streaming=True)

async def chat_node(state: State):
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}

graph = StateGraph(State)
graph.add_node("chat", chat_node)
graph.add_edge(START, "chat")
graph.add_edge("chat", END)
agent = graph.compile(checkpointer=MemorySaver())

# SSE 엔드포인트
@app.post("/api/chat/stream")
async def stream_chat(request: Request):
    body = await request.json()
    message = body.get("message", "")
    thread_id = body.get("thread_id", "default")

    async def generate():
        config = {"configurable": {"thread_id": thread_id}}
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=message)]},
            config=config,
            version="v2"
        ):
            if await request.is_disconnected():
                break

            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

# WebSocket 엔드포인트
@app.websocket("/ws/chat/{thread_id}")
async def ws_chat(websocket: WebSocket, thread_id: str):
    await websocket.accept()
    config = {"configurable": {"thread_id": thread_id}}

    try:
        while True:
            data = await websocket.receive_json()
            message = data.get("message", "")

            async for event in agent.astream_events(
                {"messages": [HumanMessage(content=message)]},
                config=config,
                version="v2"
            ):
                if event["event"] == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        await websocket.send_json({"content": content})

            await websocket.send_json({"done": True})

    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 다음 단계

다음 섹션에서는 Human-in-the-Loop 등 고급 기능을 알아봅니다.
