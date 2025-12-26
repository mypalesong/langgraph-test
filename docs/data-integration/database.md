---
sidebar_position: 2
---

# 데이터베이스 연동

LangGraph에서 관계형 데이터베이스(PostgreSQL, MySQL)와 NoSQL(MongoDB)을 연동하는 방법을 알아봅니다.

## PostgreSQL 연동

### 설치

```bash
pip install asyncpg sqlalchemy psycopg2-binary
```

### 기본 설정

```python
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# 동기 연결
engine = create_engine("postgresql://user:password@localhost/dbname")

# 비동기 연결
async_engine = create_async_engine(
    "postgresql+asyncpg://user:password@localhost/dbname"
)
AsyncSessionLocal = sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)
```

### 데이터베이스 노드 구현

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages

class DBState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    query: str
    db_results: list[dict]

async def query_database(state: DBState) -> dict:
    """데이터베이스에서 데이터를 조회하는 노드"""
    query = state["query"]

    async with AsyncSessionLocal() as session:
        result = await session.execute(text(query))
        rows = result.fetchall()

        # 결과를 딕셔너리 리스트로 변환
        columns = result.keys()
        db_results = [dict(zip(columns, row)) for row in rows]

    return {"db_results": db_results}
```

### 자연어를 SQL로 변환

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI(model="gpt-4o-mini")

SQL_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a SQL expert. Convert the user's natural language query to SQL.
    Available tables:
    - users (id, name, email, created_at)
    - orders (id, user_id, product_id, quantity, created_at)
    - products (id, name, price, category)

    Only return the SQL query, nothing else."""),
    ("human", "{question}")
])

def nl_to_sql_node(state: DBState) -> dict:
    """자연어를 SQL로 변환하는 노드"""
    question = state["messages"][-1].content

    response = llm.invoke(SQL_PROMPT.format_messages(question=question))
    sql_query = response.content.strip()

    return {"query": sql_query}

# 그래프 구성
graph = StateGraph(DBState)
graph.add_node("nl_to_sql", nl_to_sql_node)
graph.add_node("execute_query", query_database)
graph.add_node("format_response", format_response_node)

graph.add_edge(START, "nl_to_sql")
graph.add_edge("nl_to_sql", "execute_query")
graph.add_edge("execute_query", "format_response")
graph.add_edge("format_response", END)
```

## MongoDB 연동

### 설치

```bash
pip install pymongo motor
```

### 기본 설정

```python
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

# 동기 클라이언트
sync_client = MongoClient("mongodb://localhost:27017")
db = sync_client["mydb"]

# 비동기 클라이언트
async_client = AsyncIOMotorClient("mongodb://localhost:27017")
async_db = async_client["mydb"]
```

### MongoDB 노드 구현

```python
class MongoState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    collection: str
    filter_query: dict
    documents: list[dict]

async def search_documents(state: MongoState) -> dict:
    """MongoDB에서 문서를 검색하는 노드"""
    collection = async_db[state["collection"]]
    filter_query = state.get("filter_query", {})

    cursor = collection.find(filter_query)
    documents = await cursor.to_list(length=100)

    # ObjectId를 문자열로 변환
    for doc in documents:
        doc["_id"] = str(doc["_id"])

    return {"documents": documents}

async def insert_document(state: MongoState) -> dict:
    """MongoDB에 문서를 삽입하는 노드"""
    collection = async_db[state["collection"]]
    document = state.get("new_document", {})

    result = await collection.insert_one(document)

    return {"inserted_id": str(result.inserted_id)}
```

## 도구로 데이터베이스 연동

에이전트가 필요할 때 데이터베이스를 조회하도록 도구로 구현:

```python
from langchain_core.tools import tool
from pydantic import BaseModel, Field

class SQLQuery(BaseModel):
    query: str = Field(description="실행할 SQL 쿼리")

class MongoQuery(BaseModel):
    collection: str = Field(description="컬렉션 이름")
    filter: dict = Field(description="검색 필터")

@tool(args_schema=SQLQuery)
async def execute_sql(query: str) -> str:
    """PostgreSQL 데이터베이스에서 SQL 쿼리를 실행합니다."""
    async with AsyncSessionLocal() as session:
        try:
            result = await session.execute(text(query))
            rows = result.fetchall()

            if not rows:
                return "쿼리 결과가 없습니다."

            return str(rows[:10])  # 최대 10개 결과 반환
        except Exception as e:
            return f"쿼리 실행 오류: {e}"

@tool(args_schema=MongoQuery)
async def search_mongo(collection: str, filter: dict) -> str:
    """MongoDB에서 문서를 검색합니다."""
    try:
        coll = async_db[collection]
        cursor = coll.find(filter)
        docs = await cursor.to_list(length=10)

        if not docs:
            return "검색 결과가 없습니다."

        return str(docs)
    except Exception as e:
        return f"검색 오류: {e}"
```

## 트랜잭션 처리

```python
async def transactional_node(state: DBState) -> dict:
    """트랜잭션이 필요한 작업을 수행하는 노드"""
    async with AsyncSessionLocal() as session:
        async with session.begin():
            try:
                # 여러 쿼리 실행
                await session.execute(
                    text("UPDATE accounts SET balance = balance - :amount WHERE id = :from_id"),
                    {"amount": 100, "from_id": 1}
                )
                await session.execute(
                    text("UPDATE accounts SET balance = balance + :amount WHERE id = :to_id"),
                    {"amount": 100, "to_id": 2}
                )

                # 자동 커밋
                return {"status": "success", "message": "이체가 완료되었습니다."}

            except Exception as e:
                # 자동 롤백
                return {"status": "error", "message": str(e)}
```

## 연결 풀링

프로덕션 환경에서는 연결 풀링을 사용합니다:

```python
from sqlalchemy.pool import QueuePool

engine = create_async_engine(
    "postgresql+asyncpg://user:password@localhost/dbname",
    poolclass=QueuePool,
    pool_size=5,           # 기본 연결 수
    max_overflow=10,       # 추가 연결 허용 수
    pool_timeout=30,       # 연결 대기 시간
    pool_recycle=1800,     # 연결 재활용 시간 (초)
)
```

## 전체 예제

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# 데이터베이스 설정
async_engine = create_async_engine("postgresql+asyncpg://localhost/mydb")
AsyncSessionLocal = sessionmaker(async_engine, class_=AsyncSession)

class ChatWithDBState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    sql_query: str | None
    db_results: list[dict]

llm = ChatOpenAI(model="gpt-4o-mini")

async def analyze_query(state: ChatWithDBState) -> dict:
    """사용자 질문을 분석하여 SQL 생성"""
    question = state["messages"][-1].content

    prompt = f"""사용자 질문을 SQL 쿼리로 변환하세요.
    테이블: users(id, name, email), orders(id, user_id, amount)

    질문: {question}
    SQL:"""

    response = await llm.ainvoke(prompt)
    return {"sql_query": response.content.strip()}

async def execute_query(state: ChatWithDBState) -> dict:
    """SQL 쿼리 실행"""
    if not state.get("sql_query"):
        return {"db_results": []}

    async with AsyncSessionLocal() as session:
        result = await session.execute(text(state["sql_query"]))
        rows = result.fetchall()
        columns = result.keys()
        return {"db_results": [dict(zip(columns, row)) for row in rows]}

async def generate_response(state: ChatWithDBState) -> dict:
    """결과를 자연어로 응답"""
    results = state["db_results"]

    prompt = f"""데이터베이스 결과를 사용자에게 친절하게 설명하세요.
    결과: {results}"""

    response = await llm.ainvoke(prompt)
    return {"messages": [AIMessage(content=response.content)]}

# 그래프 구성
graph = StateGraph(ChatWithDBState)
graph.add_node("analyze", analyze_query)
graph.add_node("execute", execute_query)
graph.add_node("respond", generate_response)

graph.add_edge(START, "analyze")
graph.add_edge("analyze", "execute")
graph.add_edge("execute", "respond")
graph.add_edge("respond", END)

app = graph.compile()

# 실행
async def main():
    result = await app.ainvoke({
        "messages": [HumanMessage(content="지난 달 주문 총액을 알려줘")],
        "sql_query": None,
        "db_results": []
    })
    print(result["messages"][-1].content)

import asyncio
asyncio.run(main())
```

## 다음 단계

다음 섹션에서는 외부 REST API와 연동하는 방법을 알아봅니다.
