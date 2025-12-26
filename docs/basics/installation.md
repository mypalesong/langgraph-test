---
sidebar_position: 2
---

# 설치 및 환경 설정

LangGraph를 사용하기 위한 설치 방법과 환경 설정을 안내합니다.

## 요구 사항

- Python 3.9 이상
- pip 또는 poetry

## 설치

### 기본 설치

```bash
pip install langgraph
```

### LangChain과 함께 설치

LangGraph는 보통 LangChain 및 LLM 프로바이더와 함께 사용됩니다:

```bash
# OpenAI 사용 시
pip install langgraph langchain-openai

# Anthropic 사용 시
pip install langgraph langchain-anthropic

# 전체 패키지 (권장)
pip install langgraph langchain langchain-openai langchain-anthropic
```

### Poetry 사용 시

```bash
poetry add langgraph langchain-openai
```

## 환경 변수 설정

### OpenAI API 키

```bash
# Linux/Mac
export OPENAI_API_KEY="sk-your-api-key"

# Windows (PowerShell)
$env:OPENAI_API_KEY="sk-your-api-key"
```

### Anthropic API 키

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

### .env 파일 사용

프로젝트 루트에 `.env` 파일을 생성하여 관리할 수 있습니다:

```bash
# .env
OPENAI_API_KEY=sk-your-api-key
ANTHROPIC_API_KEY=your-api-key
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your-langsmith-key
```

Python에서 로드:

```python
from dotenv import load_dotenv
load_dotenv()
```

## 추가 패키지

### 데이터베이스 연동

```bash
# PostgreSQL 체크포인터
pip install langgraph-checkpoint-postgres

# SQLite 체크포인터
pip install langgraph-checkpoint-sqlite
```

### 벡터 스토어

```bash
# Chroma
pip install chromadb

# Pinecone
pip install pinecone-client

# FAISS
pip install faiss-cpu  # 또는 faiss-gpu
```

### 웹 프레임워크

```bash
# FastAPI
pip install fastapi uvicorn

# LangServe (LangChain 서버)
pip install langserve
```

## 설치 확인

설치가 완료되면 다음 코드로 확인합니다:

```python
import langgraph
print(f"LangGraph version: {langgraph.__version__}")

from langgraph.graph import StateGraph, END
print("LangGraph imported successfully!")
```

## 개발 환경 구성

### 권장 프로젝트 구조

```
my-langgraph-project/
├── .env                    # 환경 변수
├── .gitignore
├── requirements.txt
├── pyproject.toml          # Poetry 사용 시
├── src/
│   ├── __init__.py
│   ├── agents/             # 에이전트 정의
│   │   ├── __init__.py
│   │   └── chat_agent.py
│   ├── graphs/             # 그래프 정의
│   │   ├── __init__.py
│   │   └── main_graph.py
│   ├── nodes/              # 노드 함수들
│   │   ├── __init__.py
│   │   └── processing.py
│   ├── state/              # 상태 정의
│   │   ├── __init__.py
│   │   └── schemas.py
│   └── tools/              # 도구 정의
│       ├── __init__.py
│       └── search.py
├── tests/
│   └── test_graph.py
└── main.py
```

### requirements.txt 예시

```text
langgraph>=0.2.0
langchain>=0.3.0
langchain-openai>=0.2.0
python-dotenv>=1.0.0
fastapi>=0.115.0
uvicorn>=0.32.0
```

### .gitignore 예시

```gitignore
# Environment
.env
.env.local

# Python
__pycache__/
*.py[cod]
.venv/
venv/

# IDE
.idea/
.vscode/

# Checkpoints
*.db
checkpoints/
```

## LangSmith 설정 (선택)

LangSmith는 LangChain 팀에서 제공하는 관측성(observability) 플랫폼입니다:

```bash
# 환경 변수 설정
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_ENDPOINT="https://api.smith.langchain.com"
export LANGCHAIN_API_KEY="your-langsmith-api-key"
export LANGCHAIN_PROJECT="my-langgraph-project"
```

설정 후 그래프 실행 시 자동으로 트레이싱됩니다.

## 다음 단계

환경 설정이 완료되었으면, 다음 섹션에서 LangGraph의 핵심 개념을 학습합니다.
