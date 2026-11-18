// LAST FLOOR V17.4.3 -- SOLO SURVIVAL scores are calculated on the server.
// This is an in-memory active match controller; only completed match results go to Postgres.
export const STAGE_POINTS = [10,10,10,10,10,10,15,15,20,20];
export class SoloEngine {
  constructor(saveRound, opts = {}) {
    this.saveRound = saveRound;
    this.nextUsers = new Map();
    this.round = null;
    this.now = opts.now || (() => Date.now());
  }
  // Real connector CHAT events only; test CHAT events may exercise mock logic, but never enter database.
  receive(comment) {
    if (!comment || (comment.source !== 'live' && comment.source !== 'test')) return;
    const userId = String(comment.platformUserId || '');
    if (!/^\d{5,30}$/.test(userId)) return; // no durable identity => do not invent one
    const key = comment.source + ':' + userId;
    const name = String(comment.name || 'ผู้เล่น').slice(0, 50);
    const cmd = String(comment.text || '');
    const r = this.round;
    if (cmd === 'เล่น') {
      if (r && (r.phase === 'starting' || r.phase === 'running')) {
        this.nextUsers.set(key,{userId,name,source:comment.source}); // opt in for another round, even if currently playing
      } else if (!r || r.phase === 'finished') this.nextUsers.set(key,{userId,name,source:comment.source});
      return;
    }
    if (!r || r.phase !== 'running' || !r.openStage || !r.players.has(key) || (cmd !== '1' && cmd !== '2')) return;
    if(this.now()>r.openStage.startTime+12000) return; // server cutoff, not merely the host UI clock
    const p = r.players.get(key);
    if (!p.alive || r.openStage.votes.has(key)) return;
    // First answer per user for the active stage is final; ignore duplicates.
    r.openStage.votes.set(key,Number(cmd)-1);
    p.name = name;
  }
  async start(roundId) {
    if (!/^[a-z0-9_-]{16,90}$/i.test(String(roundId||''))) throw new Error('invalid round ID');
    if (this.round && this.round.phase === 'running') throw new Error('round still in progress');
    if (this.round && this.round.id === roundId) return this.snapshot();
    const players = new Map();
    for (const [key,u] of this.nextUsers) players.set(key,{...u,key,score:0,hearts:2,missCount:0,alive:true,correct:0,streak:0,bestStreak:0,floors:0});
    if (!players.size) throw new Error('no verified participants have joined the lobby');
    this.nextUsers.clear();
    this.round={id:roundId,phase:'running',players,index:-1,openStage:null,resolved:0,startedAt:this.now(),champions:[],saveStatus:'pending'};
    return this.snapshot();
  }
  stageStart(roundId,index,safeChoice) {
    const r=this.requireRound(roundId);
    if (r.phase !== 'running') throw new Error('not running');
    if (!Number.isInteger(index)||index!==r.resolved||index<0||index>=10) throw new Error('stage out of order');
    if (safeChoice!==0 && safeChoice!==1)throw new Error('safeChoice must be 0 or 1');
    if (r.openStage){if(r.openStage.index===index&&r.openStage.safer===safeChoice)return this.snapshot();throw new Error('stage already open');}
    r.index=index;
    r.openStage={index,safer:safeChoice,votes:new Map(),startTime:this.now()};
    return this.snapshot();
  }
  stageResolve(roundId,index) {
    const r=this.requireRound(roundId);
    if (r.phase!=='running')throw new Error('round not running');
    if (r.resolved===index+1 && r.openStage===null) return this.snapshot(); // retry-safe
    const s=r.openStage;
    if(!s||s.index!==index)throw new Error('stage not open');
    for(const p of r.players.values()){
      if(!p.alive)continue;
      if(s.votes.has(p.key)){
        const hit=s.votes.get(p.key)===s.safer;
        if(hit){p.score+=STAGE_POINTS[index];p.correct++;p.streak++;p.bestStreak=Math.max(p.streak,p.bestStreak)}
        else {p.hearts--;p.streak=0;if(p.hearts<=0)p.alive=false}
      }else{p.missCount++;p.streak=0;if(p.missCount>=2)p.alive=false}
      if(p.alive)p.floors=index+1;
    }
    r.resolved++;
    r.openStage=null;
    return this.snapshot();
  }
  async finish(roundId) {
    const r=this.requireRound(roundId);
    if(r.phase==='finished')return this.snapshot();
    const hasSurvivors=[...r.players.values()].some(p=>p.alive);
    if(r.openStage||!(r.resolved===10 || (r.resolved>0&&!hasSurvivors)))throw new Error('finish only after ten stages, or when all players are eliminated');
    const alive=[...r.players.values()].filter(p=>p.alive);
    const highest=alive.length?Math.max(...alive.map(p=>p.score)):null;
    const champions=alive.filter(p=>p.score===highest);
    // Commit only real TikTok accounts. Test accounts never enter the durable rankings.
    const rows=[...r.players.values()].filter(p=>p.source==='live').map(p=>({userId:p.userId,name:p.name,points:p.score,correct:p.correct,bestStreak:p.bestStreak,bestFloor:p.floors,finished:p.alive,champion:champions.some(w=>w.key===p.key)}));
    const saved=rows.length?await this.saveRound(r.id,rows):false;
    r.phase='finished';r.saveStatus=saved?'saved':'test_only';r.champions=champions.map(p=>p.key);
    return this.snapshot();
  }
  requireRound(id){if(!this.round||this.round.id!==id)throw new Error('unknown round ID');return this.round}
  snapshot(){const r=this.round;return {active:!!r,id:r?.id||null,phase:r?.phase||'lobby',stage:r?.index??-1,resolved:r?.resolved||0,ready:(this.nextUsers.size),players:r?.players.size||0,alive:r?[...r.players.values()].filter(p=>p.alive).length:0,champions:r?.champions?.length||0,saveStatus:r?.saveStatus||''}}
}
