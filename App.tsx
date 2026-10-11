import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  api,
  Application,
  setSessionToken,
  Stage,
  User,
  Vacancy,
} from './src/api';
import {
  API_BASE_URL,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from './src/config';

type Tab = 'Resumo' | 'Vagas' | 'Aprovações';
type Metrics = {
  open_vacancies: number;
  active_applications: number;
  hires: number;
  pending_approvals: number;
  overdue_applications: number;
  avg_days_to_hire: number | null;
};

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
  iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
});

function App() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<{ user: User; token: string } | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>('Resumo');
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [stageCounts, setStageCounts] = useState<
    Array<{ name: string; active_candidates: number }>
  >([]);
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const [vacancyForm, setVacancyForm] = useState(false);
  const [candidateForm, setCandidateForm] = useState(false);
  const [closureTarget, setClosureTarget] = useState<Application | null>(null);
  const [closureKind, setClosureKind] = useState<'REJECTION' | 'WITHDRAWAL'>(
    'REJECTION',
  );
  const [closureReasons, setClosureReasons] = useState<
    Array<{ id: string; kind: string; label: string; requires_note: boolean }>
  >([]);
  const [closureReasonId, setClosureReasonId] = useState('');
  const [closureComment, setClosureComment] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    requirements: '',
    city: '',
    workModel: 'Híbrido',
    openings: '1',
  });
  const [candidate, setCandidate] = useState({
    fullName: '',
    email: '',
    phone: '',
    resumeUrl: '',
    city: '',
  });

  const canManageVacancies = ['ADMIN', 'HIRING_MANAGER'].includes(
    session?.user.role || '',
  );
  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const [vacancyResult, summaryResult, approvalResult] = await Promise.all([
        api<{ items: Vacancy[] }>('/vacancies'),
        api<{
          metrics: Metrics;
          stages: Array<{ name: string; active_candidates: number }>;
        }>('/dashboard/summary'),
        api<{ items: any[] }>('/approvals'),
      ]);
      setVacancies(vacancyResult.items);
      setMetrics(summaryResult.metrics);
      setStageCounts(summaryResult.stages);
      setApprovals(approvalResult.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  const openVacancy = async (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy);
    setLoading(true);
    setError('');
    try {
      const [stageResult, appResult] = await Promise.all([
        api<{ items: Stage[] }>(`/vacancies/${vacancy.id}/stages`),
        api<{ items: Application[] }>(`/vacancies/${vacancy.id}/applications`),
      ]);
      setStages(stageResult.items.filter(stage => stage.active));
      setApplications(appResult.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    if (!GOOGLE_WEB_CLIENT_ID) {
      setError(
        'Configure GOOGLE_WEB_CLIENT_ID em src/config.ts e os clientes OAuth no Google Cloud.',
      );
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (Platform.OS === 'android')
        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') return;
      const credential =
        response.data.idToken || (await GoogleSignin.getTokens()).idToken;
      if (!credential)
        throw new Error(
          'O Google não retornou um token de identidade. Confira a configuração OAuth.',
        );
      const result = await api<{ token: string; user: User }>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
      setSessionToken(result.token);
      setSession({ user: result.user, token: result.token });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await GoogleSignin.signOut();
    } catch {
      /* Local session is still cleared. */
    }
    setSessionToken(null);
    setSession(null);
    setSelectedVacancy(null);
    setMetrics(null);
  };

  const createVacancy = async () => {
    if (
      !form.title.trim() ||
      !form.description.trim() ||
      !form.requirements.trim()
    ) {
      setError('Preencha título, descrição e requisitos.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api<{ item: Vacancy }>('/vacancies', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          openings: Number(form.openings),
          city: form.city || undefined,
        }),
      });
      setVacancyForm(false);
      setForm({
        title: '',
        description: '',
        requirements: '',
        city: '',
        workModel: 'Híbrido',
        openings: '1',
      });
      await loadData();
      await openVacancy(result.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addCandidate = async () => {
    if (!selectedVacancy) return;
    setLoading(true);
    setError('');
    try {
      await api('/applications', {
        method: 'POST',
        body: JSON.stringify({ vacancyId: selectedVacancy.id, candidate }),
      });
      setCandidateForm(false);
      setCandidate({
        fullName: '',
        email: '',
        phone: '',
        resumeUrl: '',
        city: '',
      });
      await openVacancy(selectedVacancy);
      setRefreshKey(value => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const moveApplication = async (application: Application) => {
    const currentIndex = stages.findIndex(
      stage => stage.id === application.current_stage_id,
    );
    const next = stages[currentIndex + 1];
    if (!next) {
      Alert.alert(
        'Última etapa',
        'Esta candidatura já está na última etapa configurada.',
      );
      return;
    }
    try {
      await api(`/applications/${application.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ toStageId: next.id }),
      });
      if (selectedVacancy) await openVacancy(selectedVacancy);
    } catch (e) {
      Alert.alert('Não foi possível mover', (e as Error).message);
    }
  };

  const rejectApplication = async (application: Application) => {
    try {
      const result = await api<{
        items: Array<{
          id: string;
          kind: string;
          label: string;
          requires_note: boolean;
        }>;
      }>('/closure-reasons');
      setClosureReasons(result.items);
      setClosureTarget(application);
      setClosureKind('REJECTION');
      setClosureReasonId('');
      setClosureComment('');
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  };

  const submitClosure = async () => {
    if (!closureTarget || !closureReasonId) {
      Alert.alert('Selecione um motivo');
      return;
    }
    try {
      await api(`/applications/${closureTarget.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          kind: closureKind,
          reasonId: closureReasonId,
          comment: closureComment || undefined,
        }),
      });
      setClosureTarget(null);
      if (selectedVacancy) await openVacancy(selectedVacancy);
    } catch (e) {
      Alert.alert('Não foi possível encerrar', (e as Error).message);
    }
  };

  const hireApplication = async (application: Application) => {
    Alert.alert(
      'Confirmar contratação',
      `Registrar ${application.full_name} como contratado?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Contratar',
          onPress: async () => {
            try {
              await api(`/applications/${application.id}/hire`, {
                method: 'POST',
              });
              if (selectedVacancy) await openVacancy(selectedVacancy);
              setRefreshKey(value => value + 1);
            } catch (e) {
              Alert.alert('Erro', (e as Error).message);
            }
          },
        },
      ],
    );
  };

  const approve = async (approvalId: string, decision: string) => {
    try {
      await api(`/approvals/${approvalId}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comment:
            decision === 'APPROVED'
              ? undefined
              : 'Decisão registrada pelo aplicativo.',
        }),
      });
      setRefreshKey(value => value + 1);
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  };

  const content = useMemo(() => {
    if (!session)
      return (
        <View style={styles.loginWrap}>
          <View style={styles.brandMark}>
            <Text style={styles.brandGlyph}>R</Text>
          </View>
          <Text style={styles.eyebrow}>RECRUITMENT TRACKER</Text>
          <Text style={styles.loginTitle}>
            Pessoas certas,{'\n'}processos claros.
          </Text>
          <Text style={styles.loginCopy}>
            Acompanhe vagas, candidaturas e decisões em um só lugar.
          </Text>
          {!GOOGLE_WEB_CLIENT_ID ? (
            <Text style={styles.configNotice}>
              Para ativar o login, configure os IDs OAuth em src/config.ts e o
              esquema de retorno no Google Cloud.
            </Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            style={[
              styles.primaryButton,
              (!GOOGLE_WEB_CLIENT_ID || loading) && styles.disabledButton,
            ]}
            onPress={signIn}
            disabled={!GOOGLE_WEB_CLIENT_ID || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Continuar com Google</Text>
            )}
          </Pressable>
          <Text style={styles.caption}>
            Acesso restrito a usuários autorizados
          </Text>
          <Text style={styles.endpoint}>API: {API_BASE_URL}</Text>
        </View>
      );

    if (selectedVacancy)
      return (
        <View style={styles.flex}>
          <View style={styles.pageHeader}>
            <Pressable onPress={() => setSelectedVacancy(null)}>
              <Text style={styles.backLink}>‹ Vagas</Text>
            </Pressable>
            <Text style={styles.pageTitle} numberOfLines={1}>
              {selectedVacancy.title}
            </Text>
            <Text style={styles.pageSubtitle}>
              {selectedVacancy.code} · {selectedVacancy.city || 'Brasil'} ·{' '}
              {selectedVacancy.work_model || 'Modelo não informado'}
            </Text>
            <View style={styles.headerActions}>
              <Text style={styles.countPill}>
                {applications.filter(app => app.status === 'ACTIVE').length}{' '}
                ativos
              </Text>
              <Pressable
                style={styles.smallButton}
                onPress={() => setCandidateForm(true)}
              >
                <Text style={styles.smallButtonText}>＋ Candidato</Text>
              </Pressable>
            </View>
          </View>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          {loading && !applications.length ? (
            <ActivityIndicator style={{ marginTop: 24 }} color="#7253a6" />
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.kanban}
          >
            {stages.map(stage => {
              const cards = applications.filter(
                application =>
                  application.status === 'ACTIVE' &&
                  application.current_stage_id === stage.id,
              );
              return (
                <View key={stage.id} style={styles.kanbanColumn}>
                  <View style={styles.columnHeader}>
                    <Text style={styles.columnTitle}>{stage.name}</Text>
                    <Text style={styles.columnCount}>{cards.length}</Text>
                  </View>
                  {stage.due_days ? (
                    <Text style={styles.columnHint}>
                      Prazo: {stage.due_days} dias
                    </Text>
                  ) : null}
                  <ScrollView
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                  >
                    {cards.map(application => (
                      <View key={application.id} style={styles.candidateCard}>
                        <View style={styles.cardTop}>
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                              {application.full_name.slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.flex}>
                            <Text
                              style={styles.candidateName}
                              numberOfLines={1}
                            >
                              {application.full_name}
                            </Text>
                            <Text
                              style={styles.candidateMeta}
                              numberOfLines={1}
                            >
                              {application.city || application.email}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.cardTags}>
                          <Text style={styles.tag}>
                            {Math.max(
                              0,
                              Math.floor(application.days_in_stage || 0),
                            )}{' '}
                            dias na etapa
                          </Text>
                          {application.pending_approvals > 0 ? (
                            <Text style={styles.approvalTag}>
                              {application.pending_approvals} aprovações
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.cardMeta}>
                          {application.note_count} notas ·{' '}
                          {application.pending_activities} pendências
                        </Text>
                        {application.resume_url ? (
                          <Pressable
                            onPress={() =>
                              Alert.alert(
                                'Currículo',
                                application.resume_url || '',
                              )
                            }
                          >
                            <Text style={styles.resumeLink}>
                              Ver currículo ↗
                            </Text>
                          </Pressable>
                        ) : null}
                        <View style={styles.cardActions}>
                          <Pressable
                            style={styles.moveButton}
                            onPress={() => moveApplication(application)}
                          >
                            <Text style={styles.moveButtonText}>Mover →</Text>
                          </Pressable>
                          {stages[stages.length - 1]?.id === stage.id ? (
                            <Pressable
                              onPress={() => hireApplication(application)}
                            >
                              <Text style={styles.hireText}>Contratar</Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            onPress={() => rejectApplication(application)}
                          >
                            <Text style={styles.rejectText}>Encerrar</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {!cards.length ? (
                      <Text style={styles.emptyColumn}>
                        Nenhuma candidatura
                      </Text>
                    ) : null}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>
        </View>
      );

    return (
      <View style={styles.flex}>
        <View style={styles.pageHeader}>
          <View style={styles.brandRow}>
            <View style={styles.brandMini}>
              <Text style={styles.brandMiniText}>R</Text>
            </View>
            <Text style={styles.brandWord}>
              recruitment<Text style={styles.brandWordLight}> tracker</Text>
            </Text>
          </View>
          <View style={styles.userRow}>
            <View style={styles.flex}>
              <Text style={styles.welcome}>
                Olá, {session.user.name.split(' ')[0]}
              </Text>
              <Text style={styles.pageSubtitle}>
                {roleLabel(session.user.role)}
              </Text>
            </View>
            <Pressable onPress={signOut}>
              <Text style={styles.signout}>Sair</Text>
            </Pressable>
          </View>
        </View>
        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
        {loading && !metrics ? (
          <ActivityIndicator style={{ marginTop: 24 }} color="#7253a6" />
        ) : null}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {tab === 'Resumo' ? (
            <>
              <View style={styles.sectionHeading}>
                <View>
                  <Text style={styles.eyebrow}>VISÃO GERAL</Text>
                  <Text style={styles.sectionTitle}>Saúde do recrutamento</Text>
                </View>
                <Pressable onPress={() => setRefreshKey(value => value + 1)}>
                  <Text style={styles.refresh}>Atualizar ↻</Text>
                </Pressable>
              </View>
              <View style={styles.metricsGrid}>
                <Metric
                  label="Vagas abertas"
                  value={metrics?.open_vacancies ?? '—'}
                  tint="lavender"
                />
                <Metric
                  label="Candidatos ativos"
                  value={metrics?.active_applications ?? '—'}
                  tint="blue"
                />
                <Metric
                  label="Contratações"
                  value={metrics?.hires ?? '—'}
                  tint="green"
                />
                <Metric
                  label="Etapas atrasadas"
                  value={metrics?.overdue_applications ?? '—'}
                  tint="amber"
                />
              </View>
              <View style={styles.metricStrip}>
                <Text style={styles.stripLabel}>Aprovações pendentes</Text>
                <Text style={styles.stripValue}>
                  {metrics?.pending_approvals ?? '—'}
                </Text>
                <Text style={styles.stripDivider}>·</Text>
                <Text style={styles.stripLabel}>Média até contratação</Text>
                <Text style={styles.stripValue}>
                  {metrics?.avg_days_to_hire ?? '—'} dias
                </Text>
              </View>
              <View style={styles.panel}>
                <View style={styles.panelHeading}>
                  <Text style={styles.panelTitle}>Pipeline ativo</Text>
                  <Text style={styles.panelCaption}>
                    candidaturas por etapa
                  </Text>
                </View>
                {stageCounts.length ? (
                  stageCounts.slice(0, 8).map((item, index) => (
                    <View key={`${item.name}-${index}`} style={styles.barRow}>
                      <Text style={styles.barName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              width: `${Math.max(
                                5,
                                Math.min(100, item.active_candidates * 12),
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.barCount}>
                        {item.active_candidates}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>
                    Crie uma vaga para visualizar o pipeline.
                  </Text>
                )}
              </View>
              <View style={styles.panel}>
                <View style={styles.panelHeading}>
                  <Text style={styles.panelTitle}>Vagas recentes</Text>
                  <Pressable onPress={() => setTab('Vagas')}>
                    <Text style={styles.link}>Ver todas</Text>
                  </Pressable>
                </View>
                {vacancies.slice(0, 3).map(vacancy => (
                  <Pressable
                    key={vacancy.id}
                    style={styles.recentVacancy}
                    onPress={() => openVacancy(vacancy)}
                  >
                    <View style={styles.vacancyIcon}>
                      <Text style={styles.vacancyIconText}>
                        {vacancy.title.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.vacancyTitle}>{vacancy.title}</Text>
                      <Text style={styles.candidateMeta}>
                        {vacancy.code} · {vacancy.city || 'Brasil'}
                      </Text>
                    </View>
                    <StatusBadge status={vacancy.status} />
                  </Pressable>
                ))}
                {!vacancies.length ? (
                  <Text style={styles.emptyText}>Nenhuma vaga cadastrada.</Text>
                ) : null}
              </View>
            </>
          ) : null}
          {tab === 'Vagas' ? (
            <>
              <View style={styles.sectionHeading}>
                <View>
                  <Text style={styles.eyebrow}>PROCESSOS SELETIVOS</Text>
                  <Text style={styles.sectionTitle}>Vagas</Text>
                </View>
                {canManageVacancies ? (
                  <Pressable
                    style={styles.smallButton}
                    onPress={() => setVacancyForm(true)}
                  >
                    <Text style={styles.smallButtonText}>＋ Nova vaga</Text>
                  </Pressable>
                ) : null}
              </View>
              {vacancies.map(vacancy => (
                <Pressable
                  key={vacancy.id}
                  style={styles.vacancyCard}
                  onPress={() => openVacancy(vacancy)}
                >
                  <View style={styles.vacancyCardTop}>
                    <View style={styles.vacancyIcon}>
                      <Text style={styles.vacancyIconText}>
                        {vacancy.title.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.vacancyTitle}>{vacancy.title}</Text>
                      <Text style={styles.candidateMeta}>
                        {vacancy.code} ·{' '}
                        {vacancy.department || 'Sem departamento'}
                      </Text>
                    </View>
                    <StatusBadge status={vacancy.status} />
                  </View>
                  <View style={styles.vacancyFooter}>
                    <Text style={styles.candidateMeta}>
                      ⌖ {vacancy.city || 'Localização não definida'} ·{' '}
                      {vacancy.work_model || 'Modelo não informado'}
                    </Text>
                    <Text style={styles.link}>Abrir pipeline →</Text>
                  </View>
                </Pressable>
              ))}
              {!vacancies.length ? (
                <EmptyState
                  title="Sem vagas por enquanto"
                  copy={
                    canManageVacancies
                      ? 'Crie a primeira vaga e configure o processo seletivo.'
                      : 'Quando uma vaga for atribuída a você, ela aparecerá aqui.'
                  }
                />
              ) : null}
            </>
          ) : null}
          {tab === 'Aprovações' ? (
            <>
              <View style={styles.sectionHeading}>
                <View>
                  <Text style={styles.eyebrow}>SUA FILA</Text>
                  <Text style={styles.sectionTitle}>Aprovações</Text>
                </View>
                <Text style={styles.countPill}>
                  {
                    approvals.filter(
                      item =>
                        item.decision === 'PENDING' ||
                        item.decision === 'NEEDS_INFORMATION',
                    ).length
                  }{' '}
                  pendentes
                </Text>
              </View>
              {approvals
                .filter(
                  item =>
                    item.decision === 'PENDING' ||
                    item.decision === 'NEEDS_INFORMATION',
                )
                .map(item => (
                  <View key={item.id} style={styles.approvalCard}>
                    <Text style={styles.eyebrow}>
                      {item.vacancy_title} · {item.stage_name}
                    </Text>
                    <Text style={styles.candidateName}>
                      {item.candidate_name}
                    </Text>
                    <Text style={styles.candidateMeta}>
                      {item.decision === 'NEEDS_INFORMATION'
                        ? 'Informação solicitada; revise para concluir.'
                        : 'Candidatura encaminhada para sua avaliação'}
                    </Text>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.approveButton}
                        onPress={() => approve(item.id, 'APPROVED')}
                      >
                        <Text style={styles.approveText}>Aprovar</Text>
                      </Pressable>
                      <Pressable
                        style={styles.declineButton}
                        onPress={() =>
                          Alert.alert(
                            'Solicitar informação?',
                            'Será registrada uma solicitação para complementar esta candidatura.',
                            [
                              { text: 'Cancelar', style: 'cancel' },
                              {
                                text: 'Solicitar',
                                onPress: () =>
                                  approve(item.id, 'NEEDS_INFORMATION'),
                              },
                            ],
                          )
                        }
                      >
                        <Text style={styles.declineText}>
                          Solicitar informação
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              {!approvals.some(
                item =>
                  item.decision === 'PENDING' ||
                  item.decision === 'NEEDS_INFORMATION',
              ) ? (
                <EmptyState
                  title="Tudo em dia"
                  copy="Você não tem aprovações pendentes."
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }, [
    session,
    error,
    loading,
    tab,
    selectedVacancy,
    vacancies,
    metrics,
    stageCounts,
    approvals,
    stages,
    applications,
    canManageVacancies,
  ]);

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(insets.top, 8),
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {content}
        {session && !selectedVacancy ? (
          <View style={styles.tabBar}>
            {(['Resumo', 'Vagas', 'Aprovações'] as Tab[]).map(item => (
              <Pressable
                key={item}
                style={styles.tabItem}
                onPress={() => setTab(item)}
              >
                <Text
                  style={[styles.tabIcon, tab === item && styles.tabActive]}
                >
                  {{ Resumo: '◫', Vagas: '▦', Aprovações: '✓' }[item]}
                </Text>
                <Text
                  style={[styles.tabLabel, tab === item && styles.tabActive]}
                >
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <FormModal
          title="Nova vaga"
          visible={vacancyForm}
          onClose={() => setVacancyForm(false)}
          onSubmit={createVacancy}
          submitLabel="Criar vaga"
          loading={loading}
        >
          <Input
            label="Título da vaga"
            value={form.title}
            onChangeText={title => setForm({ ...form, title })}
            placeholder="Ex.: Product Designer"
          />
          <Input
            label="Descrição"
            value={form.description}
            onChangeText={description => setForm({ ...form, description })}
            placeholder="Responsabilidades e contexto"
            multiline
          />
          <Input
            label="Requisitos"
            value={form.requirements}
            onChangeText={requirements => setForm({ ...form, requirements })}
            placeholder="Experiência e requisitos"
            multiline
          />
          <Input
            label="Cidade"
            value={form.city}
            onChangeText={city => setForm({ ...form, city })}
            placeholder="São Paulo"
          />
          <Input
            label="Posições"
            value={form.openings}
            onChangeText={openings => setForm({ ...form, openings })}
            keyboardType="number-pad"
          />
        </FormModal>
        <FormModal
          title="Adicionar candidato"
          visible={candidateForm}
          onClose={() => setCandidateForm(false)}
          onSubmit={addCandidate}
          submitLabel="Criar candidatura"
          loading={loading}
        >
          <Input
            label="Nome completo"
            value={candidate.fullName}
            onChangeText={fullName => setCandidate({ ...candidate, fullName })}
            placeholder="Nome do candidato"
          />
          <Input
            label="E-mail"
            value={candidate.email}
            onChangeText={email => setCandidate({ ...candidate, email })}
            keyboardType="email-address"
            placeholder="nome@email.com"
          />
          <Input
            label="Telefone"
            value={candidate.phone}
            onChangeText={phone => setCandidate({ ...candidate, phone })}
            keyboardType="phone-pad"
            placeholder="+55 11 99999-0000"
          />
          <Input
            label="Cidade"
            value={candidate.city}
            onChangeText={city => setCandidate({ ...candidate, city })}
            placeholder="São Paulo"
          />
          <Input
            label="Link do currículo"
            value={candidate.resumeUrl}
            onChangeText={resumeUrl =>
              setCandidate({ ...candidate, resumeUrl })
            }
            placeholder="https://..."
          />
        </FormModal>
        <Modal
          visible={Boolean(closureTarget)}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setClosureTarget(null)}
        >
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Encerrar candidatura</Text>
              <Pressable onPress={() => setClosureTarget(null)}>
                <Text style={styles.modalClose}>Fechar</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.formBody}>
              <Text style={styles.inputLabel}>Tipo de encerramento</Text>
              <View style={styles.closureKinds}>
                <Pressable
                  style={[
                    styles.kindButton,
                    closureKind === 'REJECTION' && styles.kindButtonActive,
                  ]}
                  onPress={() => {
                    setClosureKind('REJECTION');
                    setClosureReasonId('');
                  }}
                >
                  <Text
                    style={[
                      styles.kindText,
                      closureKind === 'REJECTION' && styles.kindTextActive,
                    ]}
                  >
                    Reprovação
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.kindButton,
                    closureKind === 'WITHDRAWAL' && styles.kindButtonActive,
                  ]}
                  onPress={() => {
                    setClosureKind('WITHDRAWAL');
                    setClosureReasonId('');
                  }}
                >
                  <Text
                    style={[
                      styles.kindText,
                      closureKind === 'WITHDRAWAL' && styles.kindTextActive,
                    ]}
                  >
                    Desistência
                  </Text>
                </Pressable>
              </View>
              {closureReasons
                .filter(reason => reason.kind === closureKind)
                .map(reason => (
                  <Pressable
                    key={reason.id}
                    style={[
                      styles.reasonOption,
                      closureReasonId === reason.id &&
                        styles.reasonOptionSelected,
                    ]}
                    onPress={() => setClosureReasonId(reason.id)}
                  >
                    <Text style={styles.reasonText}>
                      {reason.label}
                      {reason.requires_note ? ' · comentário obrigatório' : ''}
                    </Text>
                  </Pressable>
                ))}
              <TextInput
                value={closureComment}
                onChangeText={setClosureComment}
                style={[styles.input, styles.multiline]}
                placeholder="Comentário ou justificativa (quando necessário)"
                placeholderTextColor="#a6a2aa"
                multiline
              />
              <Pressable style={styles.primaryButton} onPress={submitClosure}>
                <Text style={styles.primaryButtonText}>
                  Confirmar encerramento
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </View>
    </>
  );
}

function Metric({
  label,
  value,
  tint,
}: {
  label: string;
  value: string | number;
  tint: 'lavender' | 'blue' | 'green' | 'amber';
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricDot, { backgroundColor: palette[tint] }]} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}
function StatusBadge({ status }: { status: string }) {
  const open = status === 'OPEN';
  return (
    <View
      style={[
        styles.statusBadge,
        open ? styles.statusOpen : styles.statusMuted,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          open ? styles.statusTextOpen : styles.statusTextMuted,
        ]}
      >
        {status === 'OPEN' ? 'Aberta' : status}
      </Text>
    </View>
  );
}
function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{copy}</Text>
    </View>
  );
}
function Input(
  props: React.ComponentProps<typeof TextInput> & { label: string },
) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{props.label}</Text>
      <TextInput
        {...props}
        placeholderTextColor="#a6a2aa"
        style={[styles.input, props.multiline && styles.multiline]}
      />
    </View>
  );
}
function FormModal({
  title,
  visible,
  onClose,
  onSubmit,
  submitLabel,
  loading,
  children,
}: React.PropsWithChildren<{
  title: string;
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  loading: boolean;
}>) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.modalClose}>Fechar</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.formBody}
        >
          {children}
          <Pressable
            style={styles.primaryButton}
            onPress={onSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{submitLabel}</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
function roleLabel(role: string) {
  return (
    (
      {
        ADMIN: 'Administrador',
        HIRING_MANAGER: 'Gestor da vaga',
        RECRUITER: 'Recrutador',
        APPROVER: 'Aprovador',
      } as Record<string, string>
    )[role] || role
  );
}

const palette = {
  bg: '#f7f5f2',
  ink: '#24212a',
  sub: '#77727d',
  purple: '#7051a4',
  lavender: '#e9e1f4',
  blue: '#dce9f5',
  green: '#dcece3',
  amber: '#f5e9ce',
  line: '#e9e5e1',
  white: '#fff',
};
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  loginWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  brandMark: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: palette.purple,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  brandGlyph: { fontSize: 27, fontWeight: '800', color: '#fff' },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: palette.sub,
    fontWeight: '800',
  },
  loginTitle: {
    fontSize: 35,
    lineHeight: 42,
    fontWeight: '700',
    color: palette.ink,
    marginTop: 12,
  },
  loginCopy: {
    fontSize: 15,
    lineHeight: 23,
    color: palette.sub,
    marginTop: 12,
    marginBottom: 26,
  },
  configNotice: {
    fontSize: 12,
    lineHeight: 18,
    color: '#986c21',
    backgroundColor: '#f8efd9',
    padding: 11,
    borderRadius: 10,
    marginBottom: 14,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: palette.purple,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabledButton: { opacity: 0.55 },
  caption: {
    textAlign: 'center',
    fontSize: 12,
    color: palette.sub,
    marginTop: 16,
  },
  endpoint: {
    textAlign: 'center',
    fontSize: 10,
    color: '#aaa5af',
    marginTop: 8,
  },
  errorText: { color: '#a33447', fontSize: 13, marginBottom: 8 },
  inlineError: {
    backgroundColor: '#fde9e8',
    color: '#9a3440',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
  },
  pageHeader: {
    backgroundColor: palette.bg,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 16,
  },
  brandMini: {
    height: 27,
    width: 27,
    borderRadius: 9,
    backgroundColor: palette.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMiniText: { fontWeight: '800', color: '#fff', fontSize: 16 },
  brandWord: { fontWeight: '800', fontSize: 15, color: palette.ink },
  brandWordLight: { fontWeight: '400', color: palette.sub },
  userRow: { flexDirection: 'row', alignItems: 'center' },
  welcome: { fontSize: 22, fontWeight: '700', color: palette.ink },
  signout: {
    fontSize: 13,
    color: palette.purple,
    fontWeight: '700',
    padding: 8,
  },
  pageTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: palette.ink,
    marginTop: 5,
  },
  pageSubtitle: { fontSize: 12, color: palette.sub, marginTop: 4 },
  backLink: { fontSize: 14, fontWeight: '700', color: palette.purple },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 13,
  },
  smallButton: {
    backgroundColor: palette.purple,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  smallButtonText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  countPill: {
    backgroundColor: '#eee8f5',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    fontSize: 11,
    color: palette.purple,
    fontWeight: '700',
  },
  scrollContent: { paddingHorizontal: 17, paddingBottom: 28 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 13,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.ink,
    marginTop: 4,
  },
  refresh: {
    fontSize: 12,
    color: palette.purple,
    fontWeight: '700',
    padding: 6,
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 100,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f0ece8',
  },
  metricDot: { height: 8, width: 8, borderRadius: 4, marginBottom: 12 },
  metricValue: { fontSize: 25, fontWeight: '700', color: palette.ink },
  metricLabel: { fontSize: 11, color: palette.sub, marginTop: 4 },
  metricStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: '#f0edf4',
    borderRadius: 13,
    padding: 13,
    marginTop: 12,
    gap: 7,
  },
  stripLabel: { fontSize: 11, color: palette.sub },
  stripValue: { fontSize: 12, fontWeight: '700', color: palette.ink },
  stripDivider: { color: '#b9b2c2', paddingHorizontal: 2 },
  panel: {
    backgroundColor: '#fff',
    borderRadius: 17,
    padding: 16,
    marginTop: 13,
    borderWidth: 1,
    borderColor: '#f0ece8',
  },
  panelHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  panelTitle: { fontSize: 15, fontWeight: '700', color: palette.ink },
  panelCaption: { fontSize: 10, color: palette.sub },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 6,
  },
  barName: { width: 110, fontSize: 10, color: palette.sub },
  barTrack: {
    height: 7,
    flex: 1,
    backgroundColor: '#f0edf3',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: { height: 7, backgroundColor: '#8668b6', borderRadius: 5 },
  barCount: {
    width: 20,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink,
  },
  emptyText: { fontSize: 12, color: palette.sub, lineHeight: 18 },
  recentVacancy: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#f1eeeb',
    gap: 11,
  },
  vacancyIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#eee8f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vacancyIconText: { fontWeight: '700', color: palette.purple },
  vacancyTitle: { fontSize: 13, fontWeight: '700', color: palette.ink },
  candidateMeta: { fontSize: 10, color: palette.sub, marginTop: 4 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 5 },
  statusOpen: { backgroundColor: '#e1f0e6' },
  statusMuted: { backgroundColor: '#efedeb' },
  statusText: { fontSize: 9, fontWeight: '700' },
  statusTextOpen: { color: '#427a58' },
  statusTextMuted: { color: palette.sub },
  tabBar: {
    height: 62,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopColor: palette.line,
    borderTopWidth: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: { alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  tabIcon: { fontSize: 17, color: '#aaa4af' },
  tabLabel: { fontSize: 10, color: '#aaa4af', marginTop: 3 },
  tabActive: { color: palette.purple, fontWeight: '700' },
  vacancyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 15,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: '#f0ece8',
  },
  vacancyCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vacancyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1eeeb',
    paddingTop: 11,
    marginTop: 12,
  },
  link: { fontSize: 11, color: palette.purple, fontWeight: '700' },
  emptyState: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: '#fff',
    borderRadius: 17,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 7,
  },
  kanban: { paddingHorizontal: 15, paddingBottom: 24, gap: 12 },
  kanbanColumn: {
    width: 282,
    maxHeight: '100%',
    backgroundColor: '#efedea',
    borderRadius: 16,
    padding: 11,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  columnTitle: { fontSize: 12, fontWeight: '700', color: palette.ink, flex: 1 },
  columnCount: {
    color: palette.sub,
    fontSize: 10,
    backgroundColor: '#e2dfdc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  columnHint: {
    fontSize: 10,
    color: palette.sub,
    marginHorizontal: 3,
    marginBottom: 8,
  },
  candidateCard: {
    backgroundColor: '#fff',
    borderRadius: 13,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#efebe7',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: {
    width: 31,
    height: 31,
    borderRadius: 11,
    backgroundColor: '#e9e1f4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: palette.purple, fontWeight: '700' },
  candidateName: { fontSize: 12, fontWeight: '700', color: palette.ink },
  cardTags: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 11 },
  tag: {
    fontSize: 9,
    color: '#635e69',
    backgroundColor: '#f3f1ef',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 8,
  },
  approvalTag: {
    fontSize: 9,
    color: '#986c21',
    backgroundColor: '#f8efd9',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 8,
  },
  cardMeta: { fontSize: 10, color: palette.sub, marginTop: 9 },
  resumeLink: {
    fontSize: 10,
    color: palette.purple,
    fontWeight: '700',
    marginTop: 9,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  moveButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: '#eee8f5',
    borderRadius: 9,
  },
  moveButtonText: { fontSize: 10, color: palette.purple, fontWeight: '700' },
  rejectText: { fontSize: 10, color: '#a34c56', fontWeight: '600' },
  emptyColumn: {
    fontSize: 10,
    color: '#aaa4af',
    textAlign: 'center',
    paddingVertical: 20,
  },
  approvalCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: palette.line,
  },
  approveButton: {
    backgroundColor: '#e1f0e6',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
  },
  approveText: { fontSize: 11, color: '#427a58', fontWeight: '700' },
  declineButton: {
    backgroundColor: '#f2efec',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
  },
  declineText: { fontSize: 10, color: palette.sub, fontWeight: '700' },
  modal: { flex: 1, backgroundColor: palette.bg, paddingTop: 20 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomColor: palette.line,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: palette.ink },
  modalClose: { fontSize: 13, color: palette.purple, fontWeight: '700' },
  formBody: { padding: 20, paddingBottom: 35 },
  inputGroup: { marginBottom: 13 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 11,
    minHeight: 46,
    paddingHorizontal: 12,
    fontSize: 13,
    color: palette.ink,
  },
  multiline: { minHeight: 85, textAlignVertical: 'top', paddingTop: 11 },
  hireText: { fontSize: 10, color: '#427a58', fontWeight: '700' },
  closureKinds: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  kindButton: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 9,
    alignItems: 'center',
  },
  kindButtonActive: { backgroundColor: '#eee8f5', borderColor: '#cfc1df' },
  kindText: { fontSize: 11, color: palette.sub },
  kindTextActive: { color: palette.purple, fontWeight: '700' },
  reasonOption: {
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.line,
    marginBottom: 7,
  },
  reasonOptionSelected: {
    borderColor: palette.purple,
    backgroundColor: '#f5f0fa',
  },
  reasonText: { fontSize: 12, color: palette.ink },
});

export default function RootApp() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}
