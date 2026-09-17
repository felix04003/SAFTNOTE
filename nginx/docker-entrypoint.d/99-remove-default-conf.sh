#!/bin/sh
# ══════════════════════════════════════════════════════════════════
# Supprime le default.conf embarqué dans l'image nginx:1.25-alpine
# (server_name localhost, listen 80) avant le démarrage réel de nginx.
#
# Lot F1 (audit 2026-09) : depuis le passage de nginx/conf.d/*.conf à
# nginx/templates/*.template (envsubst), ce fichier n'est plus écrasé par
# bind mount. S'il reste, il entre en conflit avec le server block généré
# depuis ecolemanager.conf.template sur le port 80 (deux server sans
# default_server explicite, l'ordre alphabétique de conf.d fait gagner
# default.conf, qui devient le vhost par défaut — la redirection HTTPS et
# les vhosts /api//health/dashboard ne seraient alors jamais atteints pour
# les requêtes sans Host correspondant).
#
# IMPORTANT : ce script doit vivre dans /docker-entrypoint.d/ (mécanisme
# officiel de l'image nginx) et NON dans `command:` du service Docker
# Compose. docker-entrypoint.sh ne lance les scripts de /docker-entrypoint.d/
# (dont 20-envsubst-on-templates.sh, qui génère nos vhosts à partir du
# template) QUE si le process lancé est exactement `nginx`/`nginx-debug`
# ($1 = "nginx"). Un `command: sh -c "rm ... && exec nginx ..."` change $1
# en "sh" et désactive silencieusement TOUT /docker-entrypoint.d/, y compris
# envsubst — nginx démarrerait alors sans aucun vhost. Le tri numérique des
# scripts (envsubst = 20-*, celui-ci = 99-*) garantit l'ordre d'exécution.
set -e
rm -f /etc/nginx/conf.d/default.conf
