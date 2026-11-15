#!/bin/sh
# Runs `mr-cast play` as a child of a shell that goes on afterwards. $1 is node, $2 the CLI, $3 the port.
"$1" "$2" play --no-voice --no-open --port "$3"
echo shell went on
