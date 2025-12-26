---
sidebar_position: 2
---

# FastAPI 통합

LangGraph를 FastAPI와 통합하여 RESTful API 및 WebSocket 서버를 구축하는 방법을 알아봅니다.

## 기본 설정

### 필요 패키지 설치

```bash
pip install fastapi uvicorn[standard] langgraph langchain-openai
```

### 기본 API 서버

```python
# main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

app = FastAPI(title="LangGraph API")

# 상태 정의
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

# 그래프 생성
llm = ChatOpenAI(model="gpt-4o-mini")

def chatbot(state: AgentState) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

graph = StateGraph(AgentState)
graph.add_node("chatbot", chatbot)
graph.add_edge(START, "chatbot")
graph.add_edge("chatbot", END)

memory = MemorySaver()
agent = graph.compile(checkpointer=memory)

# API 스키마
class ChatRequest(BaseModel):
    message: str
    thread_id: str = "default"

class ChatResponse(BaseModel):
    response: str
    thread_id: str

# 엔드포인트
@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}

    result = await agent.ainvoke(
        {"messages": [HumanMessage(content=request.message)]},
        config=config
    )

    return ChatResponse(
        response=result["messages"][-1].content,
        thread_id=request.thread_id
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 스트리밍 응답

### Server-Sent Events (SSE)

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator
import json

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}

    async def generate() -> AsyncGenerator[str, None]:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=request.message)]},
            config=config,
            version="v2"
        ):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"

            elif kind == "on_chain_end":
                yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
```

### WebSocket

```python
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict

# 연결 관리
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)

    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)

            config = {"configurable": {"thread_id": client_id}}

            # 스트리밍 응답
            async for event in agent.astream_events(
                {"messages": [HumanMessage(content=message_data["message"])]},
                config=config,
                version="v2"
            ):
                if event["event"] == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        await manager.send_message(
                            json.dumps({"type": "token", "content": content}),
                            client_id
                        )

            await manager.send_message(
                json.dumps({"type": "done"}),
                client_id
            )

    except WebSocketDisconnect:
        manager.disconnect(client_id)
```

## 고급 API 설계

### 라우터 분리

```python
# app/api/routes/chat.py
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_agent
from app.api.schemas.chat import ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])

@router.post("/", response_model=ChatResponse)
async def create_chat(
    request: ChatRequest,
    agent = Depends(get_agent)
):
    """새 채팅 메시지를 보냅니다."""
    config = {"configurable": {"thread_id": request.thread_id}}

    try:
        result = await agent.ainvoke(
            {"messages": [HumanMessage(content=request.message)]},
            config=config
        )
        return ChatResponse(
            response=result["messages"][-1].content,
            thread_id=request.thread_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history/{thread_id}")
async def get_history(
    thread_id: str,
    agent = Depends(get_agent)
):
    """대화 기록을 조회합니다."""
    config = {"configurable": {"thread_id": thread_id}}

    try:
        state = await agent.aget_state(config)
        messages = []
        for msg in state.values.get("messages", []):
            messages.append({
                "role": "user" if isinstance(msg, HumanMessage) else "assistant",
                "content": msg.content
            })
        return {"messages": messages}
    except Exception as e:
        raise HTTPException(status_code=404, detail="Thread not found")
```

### 스키마 정의

```python
# app/api/schemas/chat.py
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    thread_id: Optional[str] = Field(default=None)

    class Config:
        json_schema_extra = {
            "example": {
                "message": "안녕하세요!",
                "thread_id": "user-123"
            }
        }

class ChatResponse(BaseModel):
    response: str
    thread_id: str
    created_at: datetime = Field(default_factory=datetime.now)

class Message(BaseModel):
    role: str
    content: str
    timestamp: Optional[datetime] = None

class HistoryResponse(BaseModel):
    thread_id: str
    messages: List[Message]
```

### 미들웨어

```python
# app/middleware.py
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging

logger = logging.getLogger(__name__)

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()

        response = await call_next(request)

        process_time = time.time() - start_time
        logger.info(
            f"{request.method} {request.url.path} "
            f"completed in {process_time:.3f}s "
            f"status={response.status_code}"
        )

        response.headers["X-Process-Time"] = str(process_time)
        return response

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = 100, window: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window
        self.requests = {}

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host
        current_time = time.time()

        # 요청 기록 정리
        if client_ip in self.requests:
            self.requests[client_ip] = [
                t for t in self.requests[client_ip]
                if current_time - t < self.window
            ]

        # 요청 수 확인
        if client_ip in self.requests and \
           len(self.requests[client_ip]) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"}
            )

        # 요청 기록
        if client_ip not in self.requests:
            self.requests[client_ip] = []
        self.requests[client_ip].append(current_time)

        return await call_next(request)
```

## 에러 핸들링

```python
# app/exceptions.py
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

class LangGraphException(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code

class ThreadNotFoundException(LangGraphException):
    def __init__(self, thread_id: str):
        super().__init__(
            message=f"Thread {thread_id} not found",
            status_code=404
        )

class TokenLimitExceededException(LangGraphException):
    def __init__(self):
        super().__init__(
            message="Token limit exceeded",
            status_code=400
        )

# 에러 핸들러 등록
@app.exception_handler(LangGraphException)
async def langgraph_exception_handler(
    request: Request,
    exc: LangGraphException
):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.__class__.__name__,
            "message": exc.message
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unexpected error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "InternalServerError",
            "message": "An unexpected error occurred"
        }
    )
```

## 완전한 예제

```python
# app/main.py
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import TypedDict, Annotated, Sequence, Optional
import json

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

# 상태 정의
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

# 그래프 생성
def create_agent():
    llm = ChatOpenAI(model="gpt-4o-mini")

    async def chatbot(state: AgentState) -> dict:
        response = await llm.ainvoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("chatbot", chatbot)
    graph.add_edge(START, "chatbot")
    graph.add_edge("chatbot", END)

    return graph.compile(checkpointer=MemorySaver())

# Lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.agent = create_agent()
    yield

# FastAPI 앱
app = FastAPI(
    title="LangGraph Chat API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 스키마
class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = "default"

class ChatResponse(BaseModel):
    response: str
    thread_id: str

# 의존성
def get_agent(request):
    return request.app.state.agent

# 엔드포인트
@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    agent = app.state.agent
    config = {"configurable": {"thread_id": request.thread_id}}

    result = await agent.ainvoke(
        {"messages": [HumanMessage(content=request.message)]},
        config=config
    )

    return ChatResponse(
        response=result["messages"][-1].content,
        thread_id=request.thread_id
    )

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    agent = app.state.agent
    config = {"configurable": {"thread_id": request.thread_id}}

    async def generate():
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=request.message)]},
            config=config,
            version="v2"
        ):
            if event["event"] == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 다음 단계

다음 섹션에서는 상태 영속성을 관리하는 방법을 알아봅니다.
