#!/usr/bin/env bash

load_runtime_env() {
  local env_file=${FIATLUX_ENV_FILE:-}
  local line key value

  [[ -n "$env_file" ]] || return 0
  if [[ ! -r "$env_file" ]]; then
    printf '无法读取 FIATLUX_ENV_FILE：%s\n' "$env_file" >&2
    return 2
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" != *=* ]]; then
      printf '环境文件包含无效行（仅允许 KEY=VALUE）：%s\n' "$env_file" >&2
      return 2
    fi
    key=${line%%=*}
    value=${line#*=}
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf '环境文件包含无效变量名：%s\n' "$key" >&2
      return 2
    fi

    if [[ "$value" == \"*\" && ${#value} -ge 2 ]]; then
      value=${value:1:${#value}-2}
    elif [[ "$value" == \'*\' && ${#value} -ge 2 ]]; then
      value=${value:1:${#value}-2}
    fi

    # An explicitly exported shell value takes precedence over the file.
    if ! declare -p "$key" >/dev/null 2>&1; then
      printf -v "$key" '%s' "$value"
      # shellcheck disable=SC2163
      export "$key"
    fi
  done <"$env_file"
}
