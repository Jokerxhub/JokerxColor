FROM python:3.13-slim

WORKDIR /app

COPY server.py /app/server.py
COPY index.html /app/index.html
COPY css/ /app/css/
COPY js/ /app/js/
COPY fonts/ /app/fonts/
COPY data/ /app/data/

EXPOSE 1314
VOLUME /app/data

CMD ["python", "server.py"]
