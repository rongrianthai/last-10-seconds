// LAST FLOOR V17.4.3 - Postgres cumulative ranking. Only server accesses DATABASE_URL.
// Every match commits in a single transaction; repeated finish requests cannot double count.
export class SoloStore {
  constructor(pool){this.pool=pool}
  static async connect(url){
    if(!url)return null;
    const {Pool}=await import('pg');
    const pool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:8000,idleTimeoutMillis:30000});
    const store=new SoloStore(pool);
    await store.init();
    return store;
  }
  async init(){
    await this.pool.query(`CREATE TABLE IF NOT EXISTS lf_rounds (
      round_id VARCHAR(90) PRIMARY KEY, finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS lf_players (
      user_id VARCHAR(30) PRIMARY KEY, display_name VARCHAR(50) NOT NULL,
      total_score BIGINT NOT NULL DEFAULT 0, rounds INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0, total_correct INT NOT NULL DEFAULT 0,
      best_score INT NOT NULL DEFAULT 0, best_floor INT NOT NULL DEFAULT 0,
      best_streak INT NOT NULL DEFAULT 0, finishes INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  }
  async saveRound(id, rows){
    if (!rows.length)return false;
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const inserted=await client.query('INSERT INTO lf_rounds(round_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING round_id',[id]);
      if(inserted.rowCount){
        // One batched SQL upsert for the entire room (rather than 1,000 network round-trips).
        for (const r of rows){
          if (!/^\d{5,30}$/.test(r.userId) || !Number.isInteger(r.points) || r.points<0 || r.points>130 ||
              !Number.isInteger(r.correct) || r.correct<0 || r.correct>10 ||
              !Number.isInteger(r.bestFloor) || r.bestFloor<0 || r.bestFloor>10 ||
              !Number.isInteger(r.bestStreak) || r.bestStreak<0 || r.bestStreak>10) throw new Error('invalid player result');
        }
        const data=JSON.stringify(rows.map(r=>({user_id:r.userId,display_name:String(r.name).slice(0,50),points:r.points,
          correct:r.correct,best_floor:r.bestFloor,best_streak:r.bestStreak,finished:!!r.finished,champion:!!r.champion})));
        await client.query(`INSERT INTO lf_players(user_id,display_name,total_score,rounds,wins,total_correct,best_score,best_floor,best_streak,finishes)
          SELECT user_id,display_name,points,1,champion::INT,correct,points,best_floor,best_streak,finished::INT
          FROM jsonb_to_recordset($1::jsonb) AS r(user_id TEXT,display_name TEXT,points INT,correct INT,best_floor INT,best_streak INT,finished BOOLEAN,champion BOOLEAN)
          ON CONFLICT(user_id) DO UPDATE SET
            display_name=EXCLUDED.display_name,
            total_score=lf_players.total_score+EXCLUDED.total_score,
            rounds=lf_players.rounds+1,wins=lf_players.wins+EXCLUDED.wins,
            total_correct=lf_players.total_correct+EXCLUDED.total_correct,
            best_score=GREATEST(lf_players.best_score,EXCLUDED.best_score),
            best_floor=GREATEST(lf_players.best_floor,EXCLUDED.best_floor),
            best_streak=GREATEST(lf_players.best_streak,EXCLUDED.best_streak),
            finishes=lf_players.finishes+EXCLUDED.finishes,updated_at=NOW()`,[data]);
      }
      await client.query('COMMIT');
      return true;
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  async leaderboard(limit=10){
    const {rows}=await this.pool.query(`SELECT user_id,display_name,total_score,rounds,wins,total_correct,best_score,best_floor,best_streak,finishes
      FROM lf_players ORDER BY total_score DESC,wins DESC,user_id ASC LIMIT $1`,[Math.min(100,Math.max(1,limit))]);
    return rows.map((r,i)=>({key:'live:'+r.user_id,name:r.display_name,source:'live',totalScore:Number(r.total_score),xp:0,rounds:r.rounds,wins:r.wins,correct:r.total_correct,bestScore:r.best_score,bestFloor:r.best_floor,bestStreak:r.best_streak,finishes:r.finishes,rank:1+rows.filter(x=>Number(x.total_score)>Number(r.total_score)).length}));
  }
  async close(){await this.pool.end()}
}
