# 기술 과제 - 채팅 시스템 개발
## 목차
- [개발 환경](#개발-환경)
- [빌드 및 실행하기](#빌드-및-실행하기)
- [기능 요구사항](#기능-요구사항)
- [데이터 모델링](#데이터-모델링)
- [흐름도](#흐름도)
- [아키텍쳐](#아키텍처)
- [폴더 구조](#폴더-구조)
- [주요 기능](#주요-기능)
- [API](#api)

<br/><br/>

## 개발 환경
- 기본 환경
    - IDE: Visual Studio Code
    - OS: Mac
    - GIT
- Server
    - Node.js (v16)
    - Express (v4.19.2)
- DB
    - MongoDB (v6.8.0)
- Infra
    - AWS EC2
    - PM 2
- 라이브러리 및 도구
    - Socket.IO (v4.7.5)
    - Redis (ioredis v5.4.1)
    - RabbitMQ (amqplib v0.10.4)
    - Docker
    - Mongoose (v8.5.1)

<br/><br/>

## 빌드 및 실행하기
### 터미널 환경
- Git, Node.js 는 설치되어 있다고 가정한다.

- .env 파일 설정
```plaintext
MONGO_URI=mongodb://localhost:27017/chatdb
PORT=5001
REDIS_URL=redis://localhost:6379
```
```
$ git clone https://github.com/juhwano/backend-challenge-chat-server.git
$ cd backend-challenge-chat-server
npm install
npm start
```

<br/><br/>

## 기능 요구사항
### 개요
- 간단한 채팅 시스템을 구현하려고 합니다.
- 사용자는 서버에 접속하여 실시간으로 메시지를 주고받을 수 있습니다.
- 많은 유저들이 이 서비스를 이용할 수 있도록 부하와 확장을 고려합니다.
  
### 필수사항
- 실시간 채팅이 가능한 환경을 구성합니다.
- 1:1 채팅 및 그룹 채팅을 모두 지원합니다.
- 웹, 앱 모두 지원하는 서버를 구성합니다.
- 사용자의 접속 상태를 알 수 있어야합니다.
- 채팅 로그는 반드시 기록되어야 합니다.
  
### 제약사항
- 그룹 채팅의 인원은 최대 100명으로 제한합니다.
- 사용자가 전달할 수 있는 메시지는 텍스트만 가능합니다.
- 텍스트 메시지의 길이는 1,000자로 제한합니다.
- 암호화는 구현하지 않아도 됩니다만, 구현한다면 어떻게 할 수 있을지 논의해볼 수 있습니다.

<br/><br/>

## 데이터 모델링
![data_modeling](https://github.com/user-attachments/assets/8f9e9a15-802b-4173-b708-50bbb5eb96a3)

<br/><br/>

## 흐름도
![chat](https://github.com/user-attachments/assets/2d924b44-8892-4617-aa83-b1497c701d87)

<br/><br/>

## 아키텍처
![architecture](https://github.com/user-attachments/assets/98a07b08-4a90-4fad-b376-dc655f27a898)

<br/><br/>

## 폴더 구조
```bash
chat-server/
├── config/                      # 설정 관련 파일
│   └── db.js                    # 데이터베이스 연결 설정
├── controllers/                 # 컨트롤러 - 요청 처리 및 응답 반환
│   ├── chatController.js        # 채팅방 생성, 조회 기능
│   ├── messageController.js     # 메시지 조회 기능
│   └── userController.js        # 사용자 로그인/로그아웃, 검색 기능
├── models/                      # 데이터 모델 - 데이터베이스 스키마 정의
│   ├── Chat.js                  # 채팅방 정보 관리
│   ├── Counter.js               # 메시지 순서 관리
│   ├── Message.js               # 메시지 정보 관리
│   └── User.js                  # 사용자 정보 관리
├── routes/                      # 라우트 - API 엔드포인트 정의
│   ├── chatRoutes.js            # 채팅방 관련 API 경로
│   ├── messageRoutes.js         # 메시지 관련 API 경로
│   └── userRoutes.js            # 사용자 관련 API 경로
├── services/                    # 서비스 - 비즈니스 로직 처리
│   └── messageService.js        # 메시지 관련 유틸리티 함수
├── .env                         # 환경 변수 설정 파일
├── Dockerfile                   # Docker 이미지 빌드 설정
├── package.json                 # 프로젝트 메타데이터 및 의존성 정보
└── server.js                    # 애플리케이션 진입점
```

<br/><br/>

## 주요 기능
### 사용자 관리
- 사용자 로그인/로그아웃
- 사용자 검색
- 사용자 접속 상태 관리
### 채팅방 관리
- 1:1 채팅방 생성 및 조회
- 그룹 채팅방 생성 및 조회
- 채팅방 번호 자동 생성
### 메시지 관리
- 메시지 전송 및 조회
- 메시지 순서 관리
- 메시지 저장 및 로깅

<br/><br/>

## API
### 사용자 API
- GET /api/users : 활성 사용자 목록 조회
- POST /api/users/login : 사용자 로그인
- POST /api/users/logout : 사용자 로그아웃
- GET /api/users/search : 사용자 검색
### 채팅방 API
- GET /api/chats : 그룹 채팅방 목록 조회
- POST /api/chats : 채팅방 생성
- GET /api/chats/one-to-one/:userId : 사용자의 1:1 채팅방 목록 조회
- GET /api/chats/group/:userId : 사용자의 그룹 채팅방 목록 조회
- GET /api/chats/:number : 채팅방 번호로 채팅방 조회
### 메시지 API
- GET /api/messages/:chatId : 채팅방의 메시지 목록 조회
