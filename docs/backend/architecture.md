---
sidebar_position: 1
---

# 백엔드 아키텍처

LangGraph를 프로덕션 백엔드로 구축하기 위한 아키텍처 설계를 알아봅니다.

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Production Architecture                        │
│                                                                       │
│  ┌─────────────┐                                                     │
│  │   Client    │                                                     │
│  │ (Web/Mobile)│                                                     │
│  └──────┬──────┘                                                     │
│         │                                                             │
│         ▼                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐            │
│  │   Nginx     │────▶│  FastAPI    │────▶│  LangGraph  │            │
│  │ (Reverse    │     │  Server     │     │   Runtime   │            │
│  │  Proxy)     │     └──────┬──────┘     └──────┬──────┘            │
│  └─────────────┘            │                   │                    │
│                             │                   │                    │
│         ┌───────────────────┼───────────────────┼───────────────┐   │
│         │                   │                   │               │   │
│         ▼                   ▼                   ▼               │   │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │   │
│  │    Redis    │     │ PostgreSQL  │     │   Vector    │       │   │
│  │   (Cache)   │     │  (State)    │     │   Store     │       │   │
│  └─────────────┘     └─────────────┘     └─────────────┘       │   │
│         │                                                       │   │
│         └───────────────────────────────────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## 핵심 컴포넌트

### 1. API Gateway (Nginx)

클라이언트 요청을 처리하고 백엔드로 라우팅합니다.

```nginx
# nginx.conf
upstream langgraph_api {
    server 127.0.0.1:8000;
    server 127.0.0.1:8001;
    keepalive 32;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://langgraph_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }

    # SSE 스트리밍을 위한 설정
    location /stream {
        proxy_pass http://langgraph_api;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

### 2. FastAPI 서버

LangGraph 그래프를 HTTP API로 노출합니다.

```python
# app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.graphs import create_main_graph
from app.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시 그래프 초기화
    app.state.graph = create_main_graph()
    yield
    # 종료 시 정리

app = FastAPI(
    title="LangGraph API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 3. LangGraph Runtime

그래프 실행 및 상태 관리를 담당합니다.

```python
# app/graphs/main.py
from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.postgres import PostgresSaver
from app.nodes import agent_node, tool_node
from app.state import AgentState

def create_main_graph():
    """메인 그래프 생성"""
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {
        "tools": "tools",
        "end": END
    })
    graph.add_edge("tools", "agent")

    # PostgreSQL 체크포인터
    checkpointer = PostgresSaver.from_conn_string(
        "postgresql://user:pass@localhost/langgraph"
    )

    return graph.compile(checkpointer=checkpointer)
```

## 레이어 구조

### 프로젝트 디렉토리 구조

```
langgraph-backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 앱 진입점
│   ├── config.py            # 설정 관리
│   ├── dependencies.py      # 의존성 주입
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── chat.py      # 채팅 API
│   │   │   ├── agents.py    # 에이전트 API
│   │   │   └── health.py    # 헬스체크
│   │   └── schemas/
│   │       ├── __init__.py
│   │       ├── chat.py      # 요청/응답 스키마
│   │       └── agent.py
│   ├── graphs/
│   │   ├── __init__.py
│   │   ├── chat_graph.py    # 채팅 그래프
│   │   ├── rag_graph.py     # RAG 그래프
│   │   └── agent_graph.py   # 에이전트 그래프
│   ├── nodes/
│   │   ├── __init__.py
│   │   ├── llm_nodes.py     # LLM 호출 노드
│   │   ├── tool_nodes.py    # 도구 실행 노드
│   │   └── retrieval.py     # 검색 노드
│   ├── state/
│   │   ├── __init__.py
│   │   └── schemas.py       # 상태 스키마
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── search.py        # 검색 도구
│   │   └── database.py      # DB 도구
│   └── services/
│       ├── __init__.py
│       ├── llm.py           # LLM 서비스
│       └── vectorstore.py   # 벡터 스토어 서비스
├── tests/
│   ├── __init__.py
│   ├── test_graphs.py
│   └── test_api.py
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── pyproject.toml
```

## 설정 관리

```python
# app/config.py
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql://localhost/langgraph"
    REDIS_URL: str = "redis://localhost:6379"

    # LLM
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4o-mini"

    # Vector Store
    CHROMA_PERSIST_DIR: str = "./chroma_db"

    # Security
    SECRET_KEY: str
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```

## 의존성 주입

```python
# app/dependencies.py
from functools import lru_cache
from langchain_openai import ChatOpenAI
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from app.config import settings

@lru_cache
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.OPENAI_MODEL,
        api_key=settings.OPENAI_API_KEY
    )

@lru_cache
def get_vectorstore() -> Chroma:
    return Chroma(
        collection_name="documents",
        embedding_function=OpenAIEmbeddings(),
        persist_directory=settings.CHROMA_PERSIST_DIR
    )

def get_graph(request):
    """요청별 그래프 인스턴스"""
    return request.app.state.graph
```

## Docker 배포

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드
COPY app/ app/

# 환경 변수
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# 실행
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres/langgraph
      - REDIS_URL=redis://redis:6379
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis
    volumes:
      - ./chroma_db:/app/chroma_db

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=langgraph
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
```

## 스케일링 전략

### 수평 스케일링

```yaml
# docker-compose.scale.yml
services:
  api:
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '1'
          memory: 2G
```

### 로드 밸런싱

```nginx
upstream langgraph_api {
    least_conn;  # 최소 연결 기반 분배
    server api_1:8000 weight=1;
    server api_2:8000 weight=1;
    server api_3:8000 weight=1;
}
```

## 다음 단계

다음 섹션에서는 FastAPI와 LangGraph의 상세한 통합 방법을 알아봅니다.
