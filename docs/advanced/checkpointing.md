---
sidebar_position: 3
---

# 체크포인팅 고급 기능

LangGraph의 체크포인팅 시스템을 활용한 고급 기능들을 알아봅니다.

## 체크포인트 구조

각 체크포인트는 다음 정보를 포함합니다:

```python
class Checkpoint:
    config: dict          # 스레드 ID, 체크포인트 ID 등
    values: dict          # 상태 값
    next: tuple[str, ...] # 다음 실행될 노드
    metadata: dict        # 타임스탬프, 단계 번호 등
    parent_config: dict   # 부모 체크포인트
```

## 타임 트래블

### 과거 상태 조회

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
app = graph.compile(checkpointer=memory)

config = {"configurable": {"thread_id": "user-123"}}

# 여러 단계 실행
app.invoke({"messages": [HumanMessage(content="첫 번째")]}, config)
app.invoke({"messages": [HumanMessage(content="두 번째")]}, config)
app.invoke({"messages": [HumanMessage(content="세 번째")]}, config)

# 히스토리 조회
history = list(app.get_state_history(config))

for i, state in enumerate(history):
    print(f"Step {i}:")
    print(f"  Checkpoint ID: {state.config['configurable']['checkpoint_id']}")
    print(f"  Messages: {len(state.values.get('messages', []))}")
    print(f"  Next: {state.next}")
    print()
```

### 특정 시점으로 복구

```python
# 특정 체크포인트로 분기
target_checkpoint = history[2]  # 3번째 상태

branch_config = {
    "configurable": {
        "thread_id": "user-123",
        "checkpoint_id": target_checkpoint.config["configurable"]["checkpoint_id"]
    }
}

# 해당 시점에서 새로운 방향으로 실행
result = app.invoke(
    {"messages": [HumanMessage(content="다른 방향으로")]},
    branch_config
)
```

### 분기 생성

```python
def create_branch(app, config, checkpoint_id, branch_name):
    """특정 체크포인트에서 새 분기 생성"""
    new_thread_id = f"{config['configurable']['thread_id']}-{branch_name}"

    # 원본 상태 가져오기
    original_config = {
        "configurable": {
            "thread_id": config["configurable"]["thread_id"],
            "checkpoint_id": checkpoint_id
        }
    }
    state = app.get_state(original_config)

    # 새 스레드에 상태 복사
    new_config = {"configurable": {"thread_id": new_thread_id}}
    app.update_state(new_config, state.values)

    return new_config

# 분기 생성
main_config = {"configurable": {"thread_id": "main"}}
branch_config = create_branch(app, main_config, "checkpoint-123", "experiment-1")

# 분기에서 계속 실행
result = app.invoke({"messages": [HumanMessage(content="실험")]}, branch_config)
```

## 커스텀 체크포인터

### 기본 구조

```python
from langgraph.checkpoint.base import BaseCheckpointSaver
from typing import Optional, Iterator
import json

class CustomCheckpointer(BaseCheckpointSaver):
    def __init__(self, storage):
        self.storage = storage

    def get_tuple(self, config: dict) -> Optional[tuple]:
        """체크포인트 조회"""
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"].get("checkpoint_id")

        data = self.storage.get(thread_id, checkpoint_id)
        if data:
            return (data["values"], data["metadata"], data["parent"])
        return None

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        """체크포인트 저장"""
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = self.generate_id()

        self.storage.put(thread_id, checkpoint_id, {
            "values": values,
            "metadata": metadata,
            "parent": config["configurable"].get("checkpoint_id")
        })

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id
            }
        }

    def list(self, config: dict) -> Iterator[dict]:
        """체크포인트 목록"""
        thread_id = config["configurable"]["thread_id"]
        for checkpoint in self.storage.list(thread_id):
            yield checkpoint
```

### Redis 체크포인터

```python
import redis
import json
from datetime import datetime

class RedisCheckpointer(BaseCheckpointSaver):
    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url)
        self.ttl = 86400 * 7  # 7일

    def _key(self, thread_id: str, checkpoint_id: str = None) -> str:
        if checkpoint_id:
            return f"checkpoint:{thread_id}:{checkpoint_id}"
        return f"checkpoint:{thread_id}:*"

    def get_tuple(self, config: dict) -> Optional[tuple]:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = config["configurable"].get("checkpoint_id")

        if checkpoint_id:
            key = self._key(thread_id, checkpoint_id)
        else:
            # 최신 체크포인트 가져오기
            keys = self.redis.keys(self._key(thread_id))
            if not keys:
                return None
            key = sorted(keys)[-1]

        data = self.redis.get(key)
        if data:
            parsed = json.loads(data)
            return (parsed["values"], parsed["metadata"], parsed.get("parent"))
        return None

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_id = f"{datetime.now().isoformat()}"

        key = self._key(thread_id, checkpoint_id)
        data = {
            "values": values,
            "metadata": metadata,
            "parent": config["configurable"].get("checkpoint_id"),
            "created_at": datetime.now().isoformat()
        }

        self.redis.setex(key, self.ttl, json.dumps(data, default=str))

        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id
            }
        }

    def list(self, config: dict) -> Iterator[dict]:
        thread_id = config["configurable"]["thread_id"]
        keys = self.redis.keys(self._key(thread_id))

        for key in sorted(keys, reverse=True):
            data = self.redis.get(key)
            if data:
                yield json.loads(data)
```

## 상태 직렬화

### 커스텀 직렬화

```python
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
import pickle
import base64

class MessageSerializer:
    @staticmethod
    def serialize(messages: list[BaseMessage]) -> str:
        """메시지 리스트를 문자열로 직렬화"""
        serialized = []
        for msg in messages:
            serialized.append({
                "type": msg.__class__.__name__,
                "content": msg.content,
                "additional_kwargs": msg.additional_kwargs
            })
        return json.dumps(serialized)

    @staticmethod
    def deserialize(data: str) -> list[BaseMessage]:
        """문자열을 메시지 리스트로 역직렬화"""
        parsed = json.loads(data)
        messages = []
        for item in parsed:
            if item["type"] == "HumanMessage":
                messages.append(HumanMessage(
                    content=item["content"],
                    additional_kwargs=item["additional_kwargs"]
                ))
            elif item["type"] == "AIMessage":
                messages.append(AIMessage(
                    content=item["content"],
                    additional_kwargs=item["additional_kwargs"]
                ))
        return messages
```

### 큰 상태 처리

```python
import zlib
import base64

class CompressedCheckpointer(BaseCheckpointSaver):
    def __init__(self, base_checkpointer):
        self.base = base_checkpointer
        self.compression_threshold = 1024  # 1KB 이상이면 압축

    def _compress(self, data: str) -> str:
        if len(data) > self.compression_threshold:
            compressed = zlib.compress(data.encode())
            return "COMPRESSED:" + base64.b64encode(compressed).decode()
        return data

    def _decompress(self, data: str) -> str:
        if data.startswith("COMPRESSED:"):
            compressed = base64.b64decode(data[11:])
            return zlib.decompress(compressed).decode()
        return data

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        # 큰 필드 압축
        compressed_values = {}
        for key, value in values.items():
            serialized = json.dumps(value, default=str)
            compressed_values[key] = self._compress(serialized)

        return self.base.put(config, compressed_values, metadata)

    def get_tuple(self, config: dict) -> Optional[tuple]:
        result = self.base.get_tuple(config)
        if not result:
            return None

        values, metadata, parent = result

        # 압축 해제
        decompressed_values = {}
        for key, value in values.items():
            decompressed = self._decompress(value)
            decompressed_values[key] = json.loads(decompressed)

        return (decompressed_values, metadata, parent)
```

## 체크포인트 정책

### 조건부 체크포인팅

```python
class ConditionalCheckpointer(BaseCheckpointSaver):
    def __init__(self, base_checkpointer, should_checkpoint_fn):
        self.base = base_checkpointer
        self.should_checkpoint = should_checkpoint_fn

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        # 조건 확인
        if self.should_checkpoint(values, metadata):
            return self.base.put(config, values, metadata)

        # 체크포인트하지 않고 현재 config 반환
        return config

# 사용 예: 중요한 변경사항만 체크포인트
def checkpoint_on_tool_use(values: dict, metadata: dict) -> bool:
    """도구 사용 시에만 체크포인트"""
    messages = values.get("messages", [])
    if messages:
        last = messages[-1]
        return hasattr(last, "tool_calls") and last.tool_calls
    return False

checkpointer = ConditionalCheckpointer(
    PostgresSaver(...),
    checkpoint_on_tool_use
)
```

### 샘플링 체크포인팅

```python
import random

class SampledCheckpointer(BaseCheckpointSaver):
    def __init__(self, base_checkpointer, sample_rate: float = 0.1):
        self.base = base_checkpointer
        self.sample_rate = sample_rate  # 10% 샘플링

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        # 랜덤 샘플링
        if random.random() < self.sample_rate:
            return self.base.put(config, values, metadata)
        return config
```

## 멀티 체크포인터

여러 저장소에 동시 저장:

```python
class MultiCheckpointer(BaseCheckpointSaver):
    def __init__(self, primary, secondaries: list):
        self.primary = primary
        self.secondaries = secondaries

    def put(self, config: dict, values: dict, metadata: dict) -> dict:
        # 기본 저장소에 저장
        result = self.primary.put(config, values, metadata)

        # 보조 저장소에 비동기 저장 (백업용)
        for secondary in self.secondaries:
            try:
                secondary.put(config, values, metadata)
            except Exception as e:
                logger.warning(f"Secondary checkpoint failed: {e}")

        return result

    def get_tuple(self, config: dict) -> Optional[tuple]:
        # 기본 저장소에서 조회
        result = self.primary.get_tuple(config)
        if result:
            return result

        # 기본 실패 시 보조에서 조회
        for secondary in self.secondaries:
            result = secondary.get_tuple(config)
            if result:
                # 기본 저장소에 복구
                self.primary.put(config, result[0], result[1])
                return result

        return None

# 사용
checkpointer = MultiCheckpointer(
    primary=PostgresSaver(...),
    secondaries=[RedisCheckpointer(...), S3Checkpointer(...)]
)
```

## 체크포인트 분석

```python
class CheckpointAnalyzer:
    def __init__(self, app):
        self.app = app

    def get_conversation_stats(self, thread_id: str) -> dict:
        """대화 통계 분석"""
        config = {"configurable": {"thread_id": thread_id}}
        history = list(self.app.get_state_history(config))

        stats = {
            "total_checkpoints": len(history),
            "total_messages": 0,
            "tool_calls": 0,
            "duration_seconds": 0,
            "nodes_visited": set()
        }

        if not history:
            return stats

        for state in history:
            messages = state.values.get("messages", [])
            stats["total_messages"] = max(stats["total_messages"], len(messages))

            for msg in messages:
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    stats["tool_calls"] += len(msg.tool_calls)

            if state.next:
                stats["nodes_visited"].update(state.next)

        # 시간 계산
        first = history[-1].metadata.get("timestamp")
        last = history[0].metadata.get("timestamp")
        if first and last:
            stats["duration_seconds"] = (last - first).total_seconds()

        stats["nodes_visited"] = list(stats["nodes_visited"])
        return stats

    def find_errors(self, thread_id: str) -> list[dict]:
        """에러 체크포인트 찾기"""
        config = {"configurable": {"thread_id": thread_id}}
        errors = []

        for state in self.app.get_state_history(config):
            if state.values.get("error"):
                errors.append({
                    "checkpoint_id": state.config["configurable"]["checkpoint_id"],
                    "error": state.values["error"],
                    "timestamp": state.metadata.get("timestamp")
                })

        return errors
```

## 정리 작업

```python
from datetime import datetime, timedelta

class CheckpointCleaner:
    def __init__(self, checkpointer):
        self.checkpointer = checkpointer

    async def cleanup_old_checkpoints(
        self,
        max_age_days: int = 30,
        keep_latest: int = 10
    ):
        """오래된 체크포인트 정리"""
        cutoff = datetime.now() - timedelta(days=max_age_days)

        # 모든 스레드 조회
        threads = await self.get_all_threads()

        for thread_id in threads:
            config = {"configurable": {"thread_id": thread_id}}
            checkpoints = list(self.checkpointer.list(config))

            # 최신 N개 제외하고 오래된 것 삭제
            to_delete = checkpoints[keep_latest:]

            for cp in to_delete:
                if cp["metadata"].get("timestamp", datetime.now()) < cutoff:
                    await self.checkpointer.delete(
                        {"configurable": {
                            "thread_id": thread_id,
                            "checkpoint_id": cp["checkpoint_id"]
                        }}
                    )

    async def get_all_threads(self) -> list[str]:
        """모든 스레드 ID 조회"""
        # 실제 구현은 저장소에 따라 다름
        pass
```

## 마무리

이로써 LangGraph의 모든 주요 기능을 다루었습니다. 이 가이드를 통해 기본 개념부터 프로덕션 수준의 백엔드 구축까지 학습할 수 있습니다.

### 추가 학습 자료

- [LangGraph 공식 문서](https://langchain-ai.github.io/langgraph/)
- [LangChain 문서](https://python.langchain.com/)
- [GitHub 예제](https://github.com/langchain-ai/langgraph/tree/main/examples)
