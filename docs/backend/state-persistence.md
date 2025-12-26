---
sidebar_position: 3
---

# 상태 영속성

LangGraph에서 상태를 영속적으로 저장하고 관리하는 방법을 알아봅니다.

## 체크포인터 개요

체크포인터(Checkpointer)는 그래프 실행 중 상태를 저장하고 복구하는 메커니즘입니다.

```
┌─────────────────────────────────────────────────────────┐
│                    Checkpointing Flow                    │
│                                                          │
│  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐     │
│  │ Node 1 │──▶│ Save   │──▶│ Node 2 │──▶│ Save   │     │
│  └────────┘   │ State  │   └────────┘   │ State  │     │
│               └───┬────┘               └───┬────┘     │
│                   │                        │           │
│                   ▼                        ▼           │
│              ┌─────────────────────────────────┐       │
│              │         Storage Backend          │       │
│              │  (Memory, SQLite, PostgreSQL)   │       │
│              └─────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

## 메모리 체크포인터

개발 및 테스트 환경에서 사용:

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
app = graph.compile(checkpointer=memory)

# 스레드 ID로 대화 구분
config = {"configurable": {"thread_id": "user-123"}}

# 실행 - 상태가 자동 저장됨
result1 = app.invoke({"messages": [HumanMessage(content="안녕")]}, config)
result2 = app.invoke({"messages": [HumanMessage(content="이전에 뭐라고 했죠?")]}, config)
```

## SQLite 체크포인터

로컬 개발 및 소규모 배포:

```bash
pip install langgraph-checkpoint-sqlite
```

```python
from langgraph.checkpoint.sqlite import SqliteSaver

# 파일 기반
checkpointer = SqliteSaver.from_conn_string("./checkpoints.db")

# 메모리 기반 (테스트용)
checkpointer = SqliteSaver.from_conn_string(":memory:")

app = graph.compile(checkpointer=checkpointer)
```

### 비동기 SQLite

```python
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

async def create_app():
    checkpointer = AsyncSqliteSaver.from_conn_string("./checkpoints.db")
    return graph.compile(checkpointer=checkpointer)
```

## PostgreSQL 체크포인터

프로덕션 환경에서 권장:

```bash
pip install langgraph-checkpoint-postgres
```

```python
from langgraph.checkpoint.postgres import PostgresSaver

# 연결 문자열로 생성
checkpointer = PostgresSaver.from_conn_string(
    "postgresql://user:password@localhost:5432/langgraph"
)

# 테이블 자동 생성
checkpointer.setup()

app = graph.compile(checkpointer=checkpointer)
```

### 비동기 PostgreSQL

```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def create_app():
    checkpointer = await AsyncPostgresSaver.from_conn_string(
        "postgresql://user:password@localhost:5432/langgraph"
    )
    await checkpointer.setup()
    return graph.compile(checkpointer=checkpointer)
```

### 연결 풀 사용

```python
from langgraph.checkpoint.postgres import PostgresSaver
import psycopg_pool

pool = psycopg_pool.ConnectionPool(
    conninfo="postgresql://user:password@localhost:5432/langgraph",
    min_size=5,
    max_size=20,
)

checkpointer = PostgresSaver(pool)
```

## 상태 조회 및 관리

### 현재 상태 조회

```python
config = {"configurable": {"thread_id": "user-123"}}

# 현재 상태 가져오기
state = app.get_state(config)
print(state.values)  # 현재 상태 값
print(state.next)    # 다음 실행될 노드

# 비동기
state = await app.aget_state(config)
```

### 상태 히스토리 조회

```python
# 모든 체크포인트 조회
for state in app.get_state_history(config):
    print(f"Step: {state.metadata.get('step')}")
    print(f"Timestamp: {state.metadata.get('timestamp')}")
    print(f"Values: {state.values}")
    print("---")
```

### 특정 체크포인트로 복구

```python
# 히스토리에서 특정 시점 찾기
history = list(app.get_state_history(config))
checkpoint_to_restore = history[2]  # 3번째 체크포인트

# 해당 체크포인트에서 재실행
restore_config = {
    "configurable": {
        "thread_id": "user-123",
        "checkpoint_id": checkpoint_to_restore.config["configurable"]["checkpoint_id"]
    }
}

result = app.invoke(
    {"messages": [HumanMessage(content="새로운 방향으로 진행")]},
    restore_config
)
```

### 상태 업데이트

```python
# 상태 직접 수정
app.update_state(
    config,
    {"messages": [AIMessage(content="수정된 응답입니다.")]}
)

# 특정 노드인 것처럼 업데이트
app.update_state(
    config,
    {"messages": [AIMessage(content="수정된 응답")]},
    as_node="agent"
)
```

## Redis를 활용한 캐싱

상태 조회 성능 향상을 위한 Redis 캐싱:

```python
import redis
import json
from typing import Optional

class CachedCheckpointer:
    def __init__(self, checkpointer, redis_url: str):
        self.checkpointer = checkpointer
        self.redis = redis.from_url(redis_url)
        self.cache_ttl = 3600  # 1시간

    def get_state(self, config: dict) -> Optional[dict]:
        thread_id = config["configurable"]["thread_id"]
        cache_key = f"state:{thread_id}"

        # 캐시 확인
        cached = self.redis.get(cache_key)
        if cached:
            return json.loads(cached)

        # 원본에서 조회
        state = self.checkpointer.get(config)
        if state:
            self.redis.setex(
                cache_key,
                self.cache_ttl,
                json.dumps(state)
            )

        return state

    def put_state(self, config: dict, state: dict):
        thread_id = config["configurable"]["thread_id"]
        cache_key = f"state:{thread_id}"

        # 원본에 저장
        self.checkpointer.put(config, state)

        # 캐시 업데이트
        self.redis.setex(
            cache_key,
            self.cache_ttl,
            json.dumps(state)
        )

    def invalidate_cache(self, thread_id: str):
        self.redis.delete(f"state:{thread_id}")
```

## 멀티 테넌트 환경

사용자/조직별로 상태를 분리:

```python
from typing import TypedDict

class TenantConfig(TypedDict):
    tenant_id: str
    user_id: str
    session_id: str

def get_thread_id(tenant_config: TenantConfig) -> str:
    """테넌트별 고유 스레드 ID 생성"""
    return f"{tenant_config['tenant_id']}:{tenant_config['user_id']}:{tenant_config['session_id']}"

# 사용
tenant = TenantConfig(
    tenant_id="org-123",
    user_id="user-456",
    session_id="session-789"
)

config = {
    "configurable": {
        "thread_id": get_thread_id(tenant)
    }
}

result = app.invoke({"messages": [HumanMessage(content="안녕")]}, config)
```

## 상태 마이그레이션

스키마 변경 시 상태 마이그레이션:

```python
from langgraph.checkpoint.postgres import PostgresSaver

def migrate_state_v1_to_v2(old_state: dict) -> dict:
    """v1 상태를 v2로 마이그레이션"""
    new_state = old_state.copy()

    # 예: 필드명 변경
    if "old_field" in new_state:
        new_state["new_field"] = new_state.pop("old_field")

    # 예: 구조 변경
    if "messages" in new_state:
        new_state["chat_history"] = new_state.pop("messages")

    new_state["_version"] = 2
    return new_state

async def migrate_all_states(checkpointer):
    """모든 상태를 마이그레이션"""
    # 모든 스레드 조회 (실제 구현 필요)
    thread_ids = await get_all_thread_ids()

    for thread_id in thread_ids:
        config = {"configurable": {"thread_id": thread_id}}

        # 현재 상태 조회
        state = await checkpointer.aget(config)

        if state and state.get("_version", 1) < 2:
            # 마이그레이션 수행
            new_state = migrate_state_v1_to_v2(state)
            await checkpointer.aput(config, new_state)

            print(f"Migrated: {thread_id}")
```

## 상태 정리 (Garbage Collection)

오래된 상태 정리:

```python
from datetime import datetime, timedelta

async def cleanup_old_states(
    checkpointer,
    max_age_days: int = 30
):
    """오래된 상태 정리"""
    cutoff_date = datetime.now() - timedelta(days=max_age_days)

    # PostgreSQL 직접 쿼리 (체크포인터 구현에 따라 다름)
    query = """
        DELETE FROM checkpoints
        WHERE created_at < $1
    """

    async with checkpointer.pool.connection() as conn:
        result = await conn.execute(query, cutoff_date)
        print(f"Deleted {result.rowcount} old checkpoints")

# 주기적 실행 (예: 매일)
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()
scheduler.add_job(
    cleanup_old_states,
    'cron',
    hour=3,  # 매일 새벽 3시
    args=[checkpointer]
)
scheduler.start()
```

## 전체 예제

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from fastapi import FastAPI, Depends
from contextlib import asynccontextmanager

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

def create_graph():
    llm = ChatOpenAI(model="gpt-4o-mini")

    async def agent(state: AgentState):
        response = await llm.ainvoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", END)
    return graph

@asynccontextmanager
async def lifespan(app: FastAPI):
    # PostgreSQL 체크포인터 설정
    checkpointer = await AsyncPostgresSaver.from_conn_string(
        "postgresql://user:pass@localhost/langgraph"
    )
    await checkpointer.setup()

    # 그래프 컴파일
    graph = create_graph()
    app.state.agent = graph.compile(checkpointer=checkpointer)

    yield

    # 정리
    await checkpointer.pool.close()

app = FastAPI(lifespan=lifespan)

@app.post("/chat")
async def chat(message: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    result = await app.state.agent.ainvoke(
        {"messages": [HumanMessage(content=message)]},
        config
    )
    return {"response": result["messages"][-1].content}

@app.get("/history/{thread_id}")
async def get_history(thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    state = await app.state.agent.aget_state(config)
    return {"messages": state.values.get("messages", [])}
```

## 다음 단계

다음 섹션에서는 실시간 스트리밍 구현 방법을 알아봅니다.
