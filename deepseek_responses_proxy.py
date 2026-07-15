#!/usr/bin/env python3
"""
Small local bridge for Codex builds that require OpenAI Responses API.

Codex -> POST /responses -> this proxy -> DeepSeek /chat/completions

It supports the subset Codex normally needs: text messages, function tools,
function call outputs, non-stream responses, and streaming text/tool-call deltas.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error


def now() -> int:
    return int(time.time())


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


def content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            text = item.get("text") or item.get("input_text") or item.get("output_text")
            if text:
                parts.append(str(text))
    return "\n".join(parts)


def responses_input_to_messages(payload: dict) -> list[dict]:
    messages: list[dict] = []
    instructions = payload.get("instructions")
    if instructions:
        messages.append({"role": "system", "content": str(instructions)})

    input_value = payload.get("input", [])
    if isinstance(input_value, str):
        messages.append({"role": "user", "content": input_value})
        return messages
    if not isinstance(input_value, list):
        return messages

    pending_assistant_tool_calls: list[dict] = []

    def flush_tool_calls() -> None:
        nonlocal pending_assistant_tool_calls
        if pending_assistant_tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": pending_assistant_tool_calls,
                }
            )
            pending_assistant_tool_calls = []

    for item in input_value:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message" or "role" in item:
            flush_tool_calls()
            role = item.get("role", "user")
            if role == "developer":
                role = "system"
            messages.append({"role": role, "content": content_to_text(item.get("content", ""))})
        elif item_type == "function_call":
            pending_assistant_tool_calls.append(
                {
                    "id": item.get("call_id") or item.get("id") or make_id("call"),
                    "type": "function",
                    "function": {
                        "name": item.get("name", ""),
                        "arguments": item.get("arguments", "{}"),
                    },
                }
            )
        elif item_type == "function_call_output":
            flush_tool_calls()
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": item.get("call_id") or item.get("id") or make_id("call"),
                    "content": content_to_text(item.get("output", "")),
                }
            )
    flush_tool_calls()
    return messages


def responses_tools_to_chat_tools(payload: dict) -> list[dict] | None:
    out = []
    for tool in payload.get("tools") or []:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") != "function":
            continue
        out.append(
            {
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters") or {},
                },
            }
        )
    return out or None


def chat_to_response(payload: dict, chat: dict) -> dict:
    choice = (chat.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    output = []
    for call in msg.get("tool_calls") or []:
        fn = call.get("function") or {}
        output.append(
            {
                "id": make_id("fc"),
                "type": "function_call",
                "status": "completed",
                "call_id": call.get("id") or make_id("call"),
                "name": fn.get("name", ""),
                "arguments": fn.get("arguments", "{}"),
            }
        )
    text = msg.get("content")
    if text:
        output.append(
            {
                "id": make_id("msg"),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        )
    return {
        "id": make_id("resp"),
        "object": "response",
        "created_at": now(),
        "status": "completed",
        "model": payload.get("model", "deepseek-chat"),
        "output": output,
        "parallel_tool_calls": True,
        "usage": chat.get("usage"),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "DeepSeekResponsesProxy/0.1"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/health"):
            self.send_json(200, {"ok": True})
        elif self.path.rstrip("/") in ("/models", "/v1/models"):
            model = self.server.deepseek_model
            self.send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": model,
                            "object": "model",
                            "created": 0,
                            "owned_by": "deepseek",
                        }
                    ],
                },
            )
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/responses", "/v1/responses"):
            self.send_json(404, {"error": f"unsupported path: {self.path}"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            self.send_json(400, {"error": f"invalid json: {exc}"})
            return

        chat_payload = {
            "model": self.server.deepseek_model,
            "messages": responses_input_to_messages(payload),
            "stream": bool(payload.get("stream")),
        }
        tools = responses_tools_to_chat_tools(payload)
        if tools:
            chat_payload["tools"] = tools
        if payload.get("tool_choice"):
            chat_payload["tool_choice"] = payload["tool_choice"]
        if payload.get("temperature") is not None:
            chat_payload["temperature"] = payload["temperature"]
        if payload.get("max_output_tokens") is not None:
            chat_payload["max_tokens"] = payload["max_output_tokens"]

        req = request.Request(
            f"{self.server.deepseek_base.rstrip('/')}/chat/completions",
            data=json.dumps(chat_payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.server.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        if chat_payload["stream"]:
            self.handle_stream(payload, req)
        else:
            self.handle_non_stream(payload, req)

    def handle_non_stream(self, payload: dict, req: request.Request) -> None:
        try:
            with request.urlopen(req, timeout=120) as resp:
                chat = json.loads(resp.read())
            self.send_json(200, chat_to_response(payload, chat))
        except error.HTTPError as exc:
            self.send_json(exc.code, {"error": exc.read().decode("utf-8", "replace")})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def sse(self, event: str, data: dict) -> None:
        self.wfile.write(f"event: {event}\n".encode())
        self.wfile.write(b"data: ")
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        self.wfile.write(b"\n\n")
        self.wfile.flush()

    def handle_stream(self, payload: dict, req: request.Request) -> None:
        response_id = make_id("resp")
        text_item_id = make_id("msg")
        tool_items: dict[int, dict] = {}
        created = now()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.sse("response.created", {"type": "response.created", "response": {"id": response_id, "object": "response", "created_at": created, "status": "in_progress", "model": payload.get("model", "deepseek-chat"), "output": []}})
        text_started = False
        text_buf: list[str] = []
        try:
            with request.urlopen(req, timeout=120) as resp:
                for raw in resp:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
                    content = delta.get("content")
                    if content:
                        if not text_started:
                            text_started = True
                            self.sse("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": {"id": text_item_id, "type": "message", "status": "in_progress", "role": "assistant", "content": []}})
                            self.sse("response.content_part.added", {"type": "response.content_part.added", "item_id": text_item_id, "output_index": 0, "content_index": 0, "part": {"type": "output_text", "text": "", "annotations": []}})
                        text_buf.append(content)
                        self.sse("response.output_text.delta", {"type": "response.output_text.delta", "item_id": text_item_id, "output_index": 0, "content_index": 0, "delta": content})
                    for tc in delta.get("tool_calls") or []:
                        idx = int(tc.get("index", 0))
                        item = tool_items.setdefault(idx, {"id": make_id("fc"), "type": "function_call", "status": "in_progress", "call_id": tc.get("id") or make_id("call"), "name": "", "arguments": ""})
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            item["name"] = fn["name"]
                        if fn.get("arguments"):
                            item["arguments"] += fn["arguments"]
            output = []
            if text_started:
                full = "".join(text_buf)
                self.sse("response.output_text.done", {"type": "response.output_text.done", "item_id": text_item_id, "output_index": 0, "content_index": 0, "text": full})
                item = {"id": text_item_id, "type": "message", "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": full, "annotations": []}]}
                self.sse("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": item})
                output.append(item)
            for idx, item in sorted(tool_items.items()):
                item["status"] = "completed"
                self.sse("response.output_item.added", {"type": "response.output_item.added", "output_index": len(output), "item": item})
                self.sse("response.output_item.done", {"type": "response.output_item.done", "output_index": len(output), "item": item})
                output.append(item)
            final = {"id": response_id, "object": "response", "created_at": created, "status": "completed", "model": payload.get("model", "deepseek-chat"), "output": output, "parallel_tool_calls": True}
            self.sse("response.completed", {"type": "response.completed", "response": final})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except Exception as exc:
            self.sse("response.failed", {"type": "response.failed", "response": {"id": response_id, "status": "failed", "error": {"message": str(exc)}}})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--deepseek-base", default="https://api.deepseek.com/v1")
    parser.add_argument("--deepseek-model", default="deepseek-chat")
    parser.add_argument("--api-key", default=os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY"))
    parser.add_argument("--api-key-file")
    args = parser.parse_args()
    if args.api_key_file and not args.api_key:
        with open(args.api_key_file, "r", encoding="utf-8") as fh:
            args.api_key = fh.read().lstrip("\ufeff").strip()
    if not args.api_key:
        raise SystemExit("Missing --api-key or DEEPSEEK_API_KEY/OPENAI_API_KEY")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.api_key = args.api_key
    server.deepseek_base = args.deepseek_base
    server.deepseek_model = args.deepseek_model
    print(f"Listening on http://{args.host}:{args.port}; forwarding to {args.deepseek_base}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
